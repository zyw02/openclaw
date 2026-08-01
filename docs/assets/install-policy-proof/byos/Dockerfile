FROM ghcr.io/trufflesecurity/trufflehog@sha256:59b244249d1a1aef4baa24fe73d3c931616264482580d806d77f6c74d26b3e42

RUN apk add --no-cache python3 py3-pip py3-virtualenv
RUN python3 -m venv /opt/semgrep \
    && /opt/semgrep/bin/pip install --no-cache-dir semgrep==1.170.0

ENV PATH="/opt/semgrep/bin:${PATH}"
ENTRYPOINT []
