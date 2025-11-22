# @watchlog/apm

🔗 **Website**: [https://watchlog.io](https://watchlog.io)

Lightweight APM (Application Performance Monitoring) library for Node.js, built on OpenTelemetry. Provides out-of-the-box auto-instrumentation and flexible controls over which spans are sent.

---

## Features

* Auto-instrumentation for HTTP, Express, MongoDB, gRPC, and more
* Manual custom spans via OpenTelemetry API
* OTLP exporter over HTTP (protobuf) for compact transport
* Environment detection (local vs Kubernetes in-cluster)
* Configurable sampling, error-only and slow-only span export
* Adjustable batching and metric export intervals

---

## Installation

```bash
npm install @watchlog/apm
# or
yarn add @watchlog/apm
```

---

## Quick Start

Load **before** any other modules to ensure full auto-instrumentation:

```js
// index.js — must be first
const { instrument } = require('@watchlog/apm');

// Initialize with your service name and options
const sdk = instrument({
  app: 'my-service',          // your application name
  errorTPS: 5,                // max 5 error spans/sec
  sendErrorTraces: true,      // always send error spans
  slowThresholdMs: 300,       // always send spans slower than 300ms
  sampleRate: 1               // random sample rate (0.0–1.0, capped at 0.3)
});

// Continue loading your application
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Hello World!'));
app.listen(3000, () => console.log('Listening on 3000'));
```

**Under the hood:**

1. Auto-instrumentation hooks supported libraries (HTTP, MongoDB, etc.)
2. Exports OTLP spans and metrics to your Watchlog endpoint
3. Detects runtime and targets `localhost` or in-cluster Watchlog agent

---

## Custom Spans

Use the OpenTelemetry API directly for manual instrumentation:

```js
const { trace } = require('@opentelemetry/api');

app.get('/db', async (req, res) => {
  const tracer = trace.getTracer('watchlog-apm', '1.0.0');
  const span = tracer.startSpan('fetch-user', {
    attributes: { 'db.system': 'mongodb', 'db.operation': 'find' }
  });

  try {
    const result = await tracer.withSpan(span, () => User.find());
    res.json(result);
  } catch (err) {
    span.recordException(err);
    res.status(500).send('Error');
  } finally {
    span.end();
  }
});
```

---

## Configuration Options

| Option                 | Type      | Default                                           | Description                                                             |
| ---------------------- | --------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `app`                  | `string`  | `node-app`                                        | Name of your application/service                                        |
| `url`                  | `string`  | *auto-detected*                                   | Base OTLP endpoint (overrides detection). Can also be set via `WATCHLOG_APM_ENDPOINT` env var |
| `headers`              | `object`  | `{}`                                              | Additional HTTP headers for the exporters                               |
| `batchOptions`         | `object`  | `{ maxBatchSize:200, scheduledDelayMillis:5000 }` | Settings for the OTLP batch processor                                   |
| `metricIntervalMillis` | `number`  | `5000`                                            | Interval (ms) for exporting metrics                                     |
| `sampleRate`           | `number`  | `1.0`                                             | Random sampling rate 0.0–1.0 (capped at **0.3**) for non-filtered spans |
| `sendErrorTraces`      | `boolean` | `false`                                           | If `true`, always export spans with non-`UNSET` status                  |
| `errorTPS`             | `number`  | `Infinity`                                        | Maximum number of error spans to export per second                      |
| `slowThresholdMs`      | `number`  | `0`                                               | If >0, always export spans whose duration exceeds this threshold        |

**Note:** The `url` option can be overridden by the `WATCHLOG_APM_ENDPOINT` environment variable. Priority order:
1. `WATCHLOG_APM_ENDPOINT` environment variable (highest priority)
2. `url` option in `instrument()` function
3. Auto-detection (local or Kubernetes)

---

## Environment Detection

The package automatically detects the runtime environment:

* **Local / non-K8s**: `http://localhost:3774/apm`
* **Kubernetes**: `http://watchlog-node-agent.monitoring.svc.cluster.local:3774/apm`

Detection steps:

1. Check for Kubernetes serviceaccount token file
2. Inspect `/proc/1/cgroup` for `kubepods`
3. DNS lookup for `kubernetes.default.svc.cluster.local`

**Manual Override:** You can override the endpoint by:
- Passing `url` option in `instrument()` function
- Setting `WATCHLOG_APM_ENDPOINT` environment variable

---

## Docker Setup

When running your Node.js app in Docker, you need to configure the correct agent endpoint.

### Using Environment Variable (Recommended)

```js
// index.js
const { instrument } = require('@watchlog/apm');

const sdk = instrument({
  app: 'my-service',
  // url will be read from WATCHLOG_APM_ENDPOINT env var if set
  errorTPS: 5,
  sendErrorTraces: true,
  slowThresholdMs: 300,
  sampleRate: 1
});

const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello World!'));
app.listen(3000);
```

**Docker Compose Example:**
```yaml
version: '3.8'

services:
  watchlog-agent:
    image: watchlog/agent:latest
    container_name: watchlog-agent
    ports:
      - "3774:3774"
    environment:
      - WATCHLOG_APIKEY=your-api-key
      - WATCHLOG_SERVER=https://log.watchlog.ir
    networks:
      - app-network

  node-app:
    build: .
    container_name: node-app
    ports:
      - "3000:3000"
    environment:
      - WATCHLOG_APM_ENDPOINT=http://watchlog-agent:3774/apm
      - NODE_ENV=production
    depends_on:
      - watchlog-agent
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
```

**Docker Run Example:**
```bash
# 1. Create network
docker network create app-network

# 2. Run Watchlog Agent
docker run -d \
  --name watchlog-agent \
  --network app-network \
  -p 3774:3774 \
  -e WATCHLOG_APIKEY="your-api-key" \
  -e WATCHLOG_SERVER="https://log.watchlog.ir" \
  watchlog/agent:latest

# 3. Run Node.js app
docker run -d \
  --name node-app \
  --network app-network \
  -p 3000:3000 \
  -e WATCHLOG_APM_ENDPOINT="http://watchlog-agent:3774/apm" \
  my-node-app
```

### Using URL Option Directly

```js
// index.js
const { instrument } = require('@watchlog/apm');

const sdk = instrument({
  app: 'my-service',
  url: 'http://watchlog-agent:3774/apm',  // Explicit agent URL
  errorTPS: 5,
  sendErrorTraces: true,
  slowThresholdMs: 300,
  sampleRate: 1
});

const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello World!'));
app.listen(3000);
```

**Important Notes:**
- When using Docker, use the container name as the hostname (e.g., `watchlog-agent`)
- Both containers must be on the same Docker network
- The agent must be running before your app starts
- Environment variable `WATCHLOG_APM_ENDPOINT` takes precedence over the `url` option

---

## License

MIT © Watchlog
