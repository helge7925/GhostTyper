FROM python:3.13-alpine

WORKDIR /app

# ffmpeg: decodes Vexa's compressed audio chunks (webm/opus) to raw PCM
# before they go to Mistral's realtime endpoint, which only accepts PCM.
RUN apk add --no-cache ffmpeg

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py /app/main.py

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info"]
