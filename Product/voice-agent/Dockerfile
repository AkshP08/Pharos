FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# sounddevice is an SDK dependency even though this agent uses room audio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libportaudio2 \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos "" --home /app --uid 10001 appuser

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Explicit source list plus .dockerignore prevents local secrets/test data from
# entering either the build context or the runtime image.
COPY --chown=appuser:appuser agent.py pharos_runtime.py pharos_semantic.py pharos_audio.py ./
RUN python -m compileall -q agent.py pharos_runtime.py pharos_semantic.py pharos_audio.py

USER appuser
EXPOSE 8081
CMD ["python", "agent.py", "start", "--log-level", "info"]
