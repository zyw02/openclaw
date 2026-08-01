FROM ghcr.io/trufflesecurity/trufflehog@sha256:59b244249d1a1aef4baa24fe73d3c931616264482580d806d77f6c74d26b3e42 AS trufflehog

FROM semgrep/semgrep@sha256:c98f8829eea377274ee4b10656458b078b88232469b2ff913f091c2317347c9d

COPY --from=trufflehog /usr/bin/trufflehog /usr/local/bin/trufflehog
ENTRYPOINT []
