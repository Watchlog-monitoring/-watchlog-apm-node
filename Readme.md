# @watchlog/apm

🔗 **Website**: [https://watchlog.io](https://watchlog.io)

Lightweight APM (Application Performance Monitoring) library for Node.js, built on OpenTelemetry. Provides out-of-the-box auto-instrumentation and makes it easy to add custom spans.

---

## Features

* Auto-instrumentation for HTTP, Express, MongoDB, gRPC, and more
* Custom span creation for manual instrumentation
* OTLP exporter over HTTP (protobuf) for compact transport
* Automatically detects runtime environment (local vs Kubernetes)
* Configurable batching and metric export intervals

---

## Installation

```bash
npm install @watchlog/apm
# or using yarn
yarn add @watchlog/apm
```

---

## Quick Start

In your main application entry (e.g., `index.js`), initialize the SDK **before** importing any other modules:

```js
// Auto-instrumentation — must be first
const { instrument } = require('@watchlog/apm');

// Provide your application name and any custom options
instrument({
  app: 'testapp',
});

// Continue with the rest of your imports
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(3000, () => console.log('Server listening on port 3000'));
```

**What happens under the hood:**

* The SDK auto-instruments supported libraries (HTTP, Express, MongoDB, etc.)
* Traces and metrics are exported to your Watchlog APM endpoint
* Environment detection routes metrics to `localhost` or the in-cluster Kubernetes service

---

## Custom Spans

You can create manual spans around arbitrary code sections to measure performance or record metadata.

```js
const api = require('express')();
const { trace } = require('@opentelemetry/api'); // Use OpenTelemetry API directly

api.get('/users/:id', async (req, res) => {
  // Get a tracer instance by name (matches your service name)
  const tracer = trace.getTracer('watchlog-apm', '1.0.0');

  // Start a custom span
  const span = tracer.startSpan('fetch-user-from-db', {
    attributes: { 'db.system': 'mongodb', 'db.operation': 'find' }
  });

  try {
    // Run your code inside a context with the active span
    const result = await tracer.withSpan(span, async () => {
      return await UserModel.findById(req.params.id);
    });

    res.json(result);
  } catch (err) {
    // Record any errors
    span.recordException(err);
    res.status(500).send('Error');
  } finally {
    // End the span
    span.end();
  }
});
```

**Key points:**

1. Import the OpenTelemetry API (`@opentelemetry/api`) to access tracing utilities.
2. Obtain a `Tracer` via `trace.getTracer(serviceName, serviceVersion)`.
3. Call `tracer.startSpan(name, options)` to create a new span.
4. Use `tracer.withSpan(span, fn)` or `context.with()` to run code in the span context.
5. Record attributes and exceptions as needed.
6. Always call `span.end()` when the operation is complete.

---

## Configuration Options

| Option                 | Type     | Default                                             | Description                               |
| ---------------------- | -------- | --------------------------------------------------- | ----------------------------------------- |
| `app`                  | `string` | `node-app`                                          | Name of your application/service          |
| `url`                  | `string` | *auto-detected*                                     | Base OTLP endpoint (overrides detection)  |
| `headers`              | `object` | `{}`                                                | Additional HTTP headers for the exporters |
| `batchOptions`         | `object` | `{ maxBatchSize: 200, scheduledDelayMillis: 5000 }` | Settings for the `BatchSpanProcessor`     |
| `metricIntervalMillis` | `number` | `5000`                                              | Interval (ms) for exporting metrics       |

---

## Environment Detection

* **Local / non-K8s**: sends to `http://127.0.0.1:3774/apm`
* **Kubernetes**: if running in-cluster, sends to `http://watchlog-node-agent.monitoring.svc.cluster.local:3774/apm`

Detection methods include:

1. Presence of serviceaccount token (`/var/run/secrets/kubernetes.io/serviceaccount/token`)
2. `cgroup` file containing `kubepods`
3. DNS lookup of `kubernetes.default.svc.cluster.local`

---

## License

MIT © Watchlog
