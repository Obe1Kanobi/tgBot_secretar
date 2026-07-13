FROM node:20-bullseye

# Установка системных зависимостей
RUN apt-get update && \
    apt-get install -y \
    wget \
    gnupg \
    pulseaudio \
    pulseaudio-utils \
    ffmpeg \
    xvfb \
    alsa-utils \
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
RUN npm install --omit=dev

# Копирование исходного кода
COPY . .

# Создание директории для записей
RUN mkdir -p /tmp/recordings

# Настройка PulseAudio для работы без звукового оборудования
# Создаём конфиг, который автоматически загружает module-null-sink
RUN mkdir -p /etc/pulse && \
    echo "load-module module-null-sink sink_name=virtual_sink sink_properties=device.description=Virtual_Sink" > /etc/pulse/default.pa && \
    echo "load-module module-always-sink" >> /etc/pulse/default.pa && \
    echo "load-module module-native-protocol-unix" >> /etc/pulse/default.pa && \
    echo "load-module module-default-device-restore" >> /etc/pulse/default.pa && \
    echo "load-module module-rescue-streams" >> /etc/pulse/default.pa && \
    echo "load-module module-suspend-on-idle" >> /etc/pulse/default.pa && \
    echo "set-default-sink virtual_sink" >> /etc/pulse/default.pa

# Экспорт порта
EXPOSE 10000

# Запуск приложения
# PulseAudio: флаги --start/--system несовместимы, запускаем демон в пользовательском
# режиме (-D); он подхватит /etc/pulse/default.pa с virtual_sink. Важно поднять его ДО
# Chrome, чтобы браузер сразу выводил звук встречи в virtual_sink
CMD ["sh", "-c", "rm -f /tmp/.X99-lock; Xvfb :99 -screen 0 1024x768x16 -ac & export DISPLAY=:99; pulseaudio -D --exit-idle-time=-1 --disallow-exit || true; sleep 2; pactl list short sinks || true; npm start"]
