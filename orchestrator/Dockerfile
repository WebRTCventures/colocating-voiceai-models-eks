FROM python:3.11-slim AS base

# Create non-root user
RUN groupadd -r agent && useradd -r -g agent -d /app -s /sbin/nologin agent

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY agent.py config.py metrics.py livekit_token.py observers.py ./

# Switch to non-root user
USER agent

EXPOSE 8080

# SIGTERM is forwarded to Python for graceful shutdown
STOPSIGNAL SIGTERM

ENTRYPOINT ["python", "agent.py"]
