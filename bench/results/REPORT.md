# Benchmark results

Requests per phase: 1000, concurrency: 32.

## Deployment & start-up

| Target | Image acquire (build/pull) | Boot → first 200 |
| --- | --- | --- |
| paasbox-sqlite | 1.6 s | 2.3 s |
| paasbox-mariadb | 722 ms | 8.0 s |
| netbox | 1.2 s | 196.8 s |

## POST (create) — throughput & latency

| Target | req/s | mean | p50 | p95 | p99 | errors |
| --- | --- | --- | --- | --- | --- | --- |
| paasbox-sqlite | 758.2 | 41.68 ms | 34.37 ms | 71.12 ms | 146.04 ms | 0 |
| paasbox-mariadb | 1130.6 | 27.79 ms | 23.6 ms | 74.82 ms | 101.96 ms | 0 |
| netbox | 57.3 | 390.36 ms | 118.41 ms | 192.06 ms | 13502.55 ms | 0 |

## GET list — throughput & latency

| Target | req/s | mean | p50 | p95 | p99 | errors |
| --- | --- | --- | --- | --- | --- | --- |
| paasbox-sqlite | 1626.3 | 19.42 ms | 18.23 ms | 34.09 ms | 42.8 ms | 0 |
| paasbox-mariadb | 1324.3 | 23.95 ms | 23.51 ms | 36.78 ms | 50.35 ms | 0 |
| netbox | 47.7 | 490.98 ms | 178.62 ms | 317.53 ms | 17044.42 ms | 0 |

## GET detail — throughput & latency

| Target | req/s | mean | p50 | p95 | p99 | errors |
| --- | --- | --- | --- | --- | --- | --- |
| paasbox-sqlite | 3744.2 | 8.46 ms | 4.73 ms | 15.21 ms | 74.36 ms | 0 |
| paasbox-mariadb | 2501.7 | 12.72 ms | 12.44 ms | 22.31 ms | 26.42 ms | 0 |
| netbox | 59.1 | 364.54 ms | 119.37 ms | 239.06 ms | 12957.41 ms | 0 |

## paasbox speedup vs NetBox (req/s ratio)

| Target | POST | GET list | GET detail |
| --- | --- | --- | --- |
| paasbox-sqlite | 13.2× | 34.1× | 63.4× |
| paasbox-mariadb | 19.7× | 27.8× | 42.3× |

