FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENAPPLY_JOBSPY_STATE=/state/state.json
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home worker \
    && mkdir /state && chown worker:worker /state && chmod 700 /state
COPY openapply_jobspy ./openapply_jobspy
USER worker
VOLUME ["/state"]
CMD ["python", "-m", "openapply_jobspy"]
