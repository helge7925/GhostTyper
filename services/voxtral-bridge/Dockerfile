FROM python:3.13-alpine

WORKDIR /app

RUN pip install --no-cache-dir \
      fastapi==0.115.6 \
      "uvicorn[standard]==0.34.0" \
      aiohttp==3.11.11 \
      python-multipart==0.0.20 \
      cachetools==5.5.0

COPY main.py /app/main.py

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info"]
