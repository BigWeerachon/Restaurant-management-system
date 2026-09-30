import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ObservabilityConfig } from "../config";

export interface Telemetry {
  /** Whether spans and metrics are being recorded (they are only when there is somewhere to send them). */
  enabled: boolean;
  shutdown(): Promise<void>;
}

const OFF: Telemetry = { enabled: false, async shutdown() {} };

/**
 * OpenTelemetry for the API — traces and metrics over OTLP/HTTP, to whatever collector or vendor the deployment points
 * at (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` for a vendor's key). With no endpoint nothing is set up
 * and the instrumentation calls in the code are no-ops, so the cost of leaving it off is zero. The SDK is loaded only
 * when it is used.
 *
 * `spanProcessors` lets a test read the spans without a collector.
 */
export async function startTelemetry(cfg: ObservabilityConfig, opts: { spanProcessors?: SpanProcessor[] } = {}): Promise<Telemetry> {
  if (!cfg.otlpEndpoint && !opts.spanProcessors?.length) return OFF;

  const [{ NodeTracerProvider }, base, { OTLPTraceExporter }, { resourceFromAttributes }, { MeterProvider, PeriodicExportingMetricReader }, { OTLPMetricExporter }, { W3CTraceContextPropagator }, api] = await Promise.all([
    import("@opentelemetry/sdk-trace-node"),
    import("@opentelemetry/sdk-trace-base"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/core"),
    import("@opentelemetry/api"),
  ]);

  const resource = resourceFromAttributes({
    "service.name": cfg.serviceName,
    ...(cfg.release ? { "service.version": cfg.release } : {}),
    "deployment.environment.name": cfg.environment,
  });

  const processors: SpanProcessor[] = [...(opts.spanProcessors ?? [])];
  if (cfg.otlpEndpoint) processors.push(new base.BatchSpanProcessor(new OTLPTraceExporter({ url: `${cfg.otlpEndpoint.replace(/\/$/, "")}/v1/traces` })));

  // Follow the caller's sampling decision; sample a share of new traces (all of them by default).
  const provider = new NodeTracerProvider({
    resource,
    sampler: new base.ParentBasedSampler({ root: new base.TraceIdRatioBasedSampler(cfg.traceSampleRatio) }),
    spanProcessors: processors,
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });

  let meters: InstanceType<typeof MeterProvider> | null = null;
  if (cfg.otlpEndpoint) {
    meters = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${cfg.otlpEndpoint.replace(/\/$/, "")}/v1/metrics` }), exportIntervalMillis: 30_000 })],
    });
    api.metrics.setGlobalMeterProvider(meters);
  }

  return {
    enabled: true,
    async shutdown() {
      // Whatever is still buffered goes out before the process does. A collector that is down must not hold shutdown up.
      await Promise.race([Promise.allSettled([provider.shutdown(), meters?.shutdown()]), new Promise((r) => setTimeout(r, 3000))]);
    },
  };
}
