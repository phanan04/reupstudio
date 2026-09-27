FROM python:3.12.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HOME=/tmp/huggingface
WORKDIR /app
COPY requirements-opus.lock.txt ./
RUN python -m pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install --no-cache-dir -r requirements-opus.lock.txt \
    && python -m pip check
COPY workers/translate_opus.py ./
ARG VIETSTUDIO_OPUS_BUILD=manual
LABEL vietstudio.opus.build=$VIETSTUDIO_OPUS_BUILD
ENTRYPOINT ["python", "/app/translate_opus.py"]
