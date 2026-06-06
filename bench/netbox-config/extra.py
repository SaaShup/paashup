# Extra NetBox settings for the benchmark, merged on top of the image's
# env-driven configuration.py. NetBox 4.6 requires API_TOKEN_PEPPERS to mint or
# validate API tokens: a dict of {int_key: str>=50 chars}.
API_TOKEN_PEPPERS = {
    0: "benchmark-only-token-pepper-please-do-not-use-in-production-0123456789",
}
