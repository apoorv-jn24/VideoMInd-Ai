FROM python:3.11-slim

# Install ffmpeg for audio/video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create the uploads folder inside the container
RUN mkdir -p uploads

# Expose the API port
EXPOSE 5000

# Start the application using Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "120", "app:app"]
