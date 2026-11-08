import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

export default {
  ...defineCloudflareConfig({ incrementalCache: kvIncrementalCache }),
  // postgres.js' `workerd` entry imports `cloudflare:sockets`, which OpenNext's esbuild step can't resolve.
  // Its default (Node) entry runs on Workers via nodejs_compat's node:net/node:tls instead.
  cloudflare: { useWorkerdCondition: false },
};
