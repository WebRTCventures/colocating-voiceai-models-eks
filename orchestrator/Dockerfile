FROM python:3.11-slim AS base

# Create non-root user
RUN groupadd -r agent && useradd -r -g agent -d /app -s /sbin/nologin agent

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY agent.py ./

# Switch to non-root user
USER agent

# SIGTERM is forwarded to Python for graceful shutdown
STOPSIGNAL SIGTERM

# LiveKit Agents uses 'start' for production mode (connects to LiveKit server
# and registers as a worker, dispatched on demand when participants join)
ENTRYPOINT ["python", "agent.py", "start"]
