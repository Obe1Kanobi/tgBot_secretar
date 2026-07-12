FROM node:18-bullseye

# Установка системных зависимостей
RUN apt-get update && \
    apt-get install -y \
    wget \
    gnupg \
    pulseaudio \
    ffmpeg \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Установка Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Создание директории приложения
WORKDIR /app

# Копирование package.json и установка зависимостей
COPY package*.json ./
RUN npm install --production

# Копирование исходного кода
COPY . .

# Создание директории для записей
RUN mkdir -p /tmp/recordings

# Экспорт порта
EXPOSE 10000

# Запуск приложения
CMD ["sh", "-c", "pulseaudio --start --exit-idle-time=-1 --system 2>/dev/null || true; rm -f /tmp/.X99-lock; Xvfb :99 -screen 0 1024x768x16 -ac & export DISPLAY=:99; sleep 2; npm start"]
