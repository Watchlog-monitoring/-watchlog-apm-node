// index.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter, OTLPMetricExporter } = require('@opentelemetry/exporter-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { SpanStatusCode } = require('@opentelemetry/api');
const fs = require('fs');

// — سینک تشخیص اجرای داخل Kubernetes —
function isRunningInK8sSync() {
  if (fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token')) return true;
  try {
    const c = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (c.includes('kubepods')) return true;
  } catch { }
  return false;
}
function getServerURLSync(defaultUrl, userProvidedUrl) {
  // If user explicitly provided a URL (via env var or option), use it directly (skip auto-detection)
  if (userProvidedUrl) {
    return userProvidedUrl;
  }
  // Otherwise, use auto-detection
  return isRunningInK8sSync()
    ? 'http://watchlog-node-agent.monitoring.svc.cluster.local:3774/apm'
    : defaultUrl;
}

// — یک پردازشگر ساده برای فیلتر اسپن‌ها —
class FilteringSpanProcessor {
  constructor(filterFn, wrappedProcessor) {
    this._filterFn = filterFn;
    this._wrapped = wrappedProcessor;
  }
  onStart(span, parentContext) {
    this._wrapped.onStart(span, parentContext);
  }
  onEnd(span) {
    if (this._filterFn(span)) {
      this._wrapped.onEnd(span);
    }
  }
  shutdown() {
    return this._wrapped.shutdown();
  }
  forceFlush() {
    return this._wrapped.forceFlush();
  }
}

/**
 * options:
 *   url                   – Base OTLP endpoint
 *   app                   – نام سرویس
 *   headers               – HTTP headers
 *   batchOptions          – { maxBatchSize, scheduledDelayMillis }
 *   metricIntervalMillis  – بازه‌ ارسال متریک‌ها
 *   errorTPS              – حداکثر تعداد اسپن خطا در ثانیه (default: Infinity)
 *   sendErrorTraces       – اگر true باشد، اسپن‌های خطا تحت قوانین TPS قرار می‌گیرند
 *   slowThresholdMs       – آستانه‌ی میلی‌ثانیه برای اسپن‌های “کند” (default: 0)
 *   sampleRate            – نرخ نمونه‌برداری رندوم بقیه‌ی اسپن‌ها (0–1، حداکثر 0.3)
 */
function instrument(options = {}) {
  const {
    url,
    app = 'node-app',
    headers = {},
    batchOptions = {},
    metricIntervalMillis = 5000,
    errorTPS = Infinity,
    sendErrorTraces = false,
    slowThresholdMs = 0,
    sampleRate = 1.0
  } = options;

  const effectiveSampleRate = Math.min(sampleRate, 0.3);
  // Priority: 1) Environment variable, 2) url option, 3) auto-detection
  const defaultUrl = 'http://localhost:3774/apm';
  const envUrl = process.env.WATCHLOG_APM_ENDPOINT;
  const userUrl = envUrl || url; // env var takes precedence over option
  
  // If user provided URL (env var or option), use it directly (skip auto-detection)
  // Otherwise, use auto-detection
  const baseUrl = getServerURLSync(defaultUrl, userUrl);
  
  console.log('🔍 Watchlog APM endpoint:', baseUrl);

  const traceExporter = new OTLPTraceExporter({ url: `${baseUrl}/${app}/v1/traces`, headers });
  const metricExporter = new OTLPMetricExporter({ url: `${baseUrl}/${app}/v1/metrics`, headers });

  const bsp = new BatchSpanProcessor(traceExporter, {
    maxExportBatchSize: batchOptions.maxBatchSize || 200,
    scheduledDelayMillis: batchOptions.scheduledDelayMillis || 5000
  });

  // متغیرهای شمارش خطا در هر ثانیه
  let lastSec = Math.floor(Date.now() / 1000);
  let errCount = 0;

  function spanFilter(span) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec !== lastSec) {
      lastSec = nowSec;
      errCount = 0;
    }

    // 1) اسپن‌های خطا (محدود به errorTPS در ثانیه)
    if (span.status.code !== SpanStatusCode.UNSET) {
      if (sendErrorTraces) {
        if (errCount < errorTPS) {
          errCount++;
          return true;
        }
        return false;
      }
      // اگر sendErrorTraces=false، خطاها تابع نمونه‌برداری عادی را دنبال می‌کنند
    }

    // 2) اسپن‌های کند (اگر آستانه تنظیم شده)
    if (slowThresholdMs > 0) {
      const [sS, sN] = span.startTime;
      const [eS, eN] = span.endTime;
      const durMs = ((eS - sS) * 1e3) + ((eN - sN) / 1e6);
      if (durMs > slowThresholdMs) {
        return true;
      }
    }

    // 3) نمونه‌برداری رندوم برای بقیه
    if (effectiveSampleRate < 1.0) {
      return Math.random() < effectiveSampleRate;
    }

    // 4) در غیر این‌صورت همه را ارسال کن
    return true;
  }

  let spanProcessor = bsp;
  if (sendErrorTraces || slowThresholdMs > 0 || effectiveSampleRate < 1.0) {
    spanProcessor = new FilteringSpanProcessor(spanFilter, bsp);
  }

  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
    spanProcessor,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricIntervalMillis
    })
  });

  try {
    sdk.start()
    console.log('🔺 Watchlog APM instrumentation started')
  } catch (err) {
    console.error('❌ Watchlog APM failed to start:', err)

  }


  return sdk;
}

module.exports = { instrument };
