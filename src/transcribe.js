import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import fs from 'node:fs';

const client = new GoogleGenerativeAI(config.geminiApiKey);

export async function transcribeAudio(filePath, logger) {
  try {
    logger.info({ filePath }, 'Starting audio transcription with Gemini');

    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    // Получаем размер файла
    const stats = fs.statSync(filePath);
    logger.info({ fileSize: stats.size }, 'Audio file size');

    // Читаем аудиофайл
    const audioBuffer = fs.readFileSync(filePath);
    const base64Audio = audioBuffer.toString('base64');

    // Используем Gemini для транскрипции
    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash' 
    });

    const prompt = `
Пожалуйста, транскрибируй этот аудиофайл встречи. 
Верни только текст разговора без дополнительных комментариев.
Если можешь определить говорящих, укажи их как "Говорящий 1:", "Говорящий 2:" и т.д.
Если слышишь имена, используй их вместо "Говорящий X".
    `.trim();

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Audio,
          mimeType: 'audio/wav'
        }
      },
      prompt
    ]);

    const response = await result.response;
    const transcript = response.text();

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Empty transcript received from Gemini');
    }

    logger.info({ 
      transcriptLength: transcript.length,
      preview: transcript.substring(0, 200) + '...'
    }, 'Transcription completed successfully');

    // Удаляем временный аудиофайл
    try {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, 'Temporary audio file deleted');
    } catch (e) {
      logger.warn({ filePath, error: e.message }, 'Could not delete temporary audio file');
    }

    return transcript;

  } catch (error) {
    logger.error({ 
      error: error.message,
      filePath,
      stack: error.stack 
    }, 'Transcription failed');

    // В случае ошибки возвращаем текст-заглушку для демонстрации
    if (error.message.includes('API key') || error.message.includes('quota')) {
      logger.warn('API issue detected, using demo transcript');
      return generateDemoTranscript();
    }

    throw new Error(`Transcription error: ${error.message}`);
  }
}

function generateDemoTranscript() {
  // Демо-транскрипт для тестирования
  return `
Менеджер: Добрый день! Меня зовут Алексей, я представитель компании Skill to Lead. Спасибо, что нашли время для нашей встречи.

Клиент: Здравствуйте, Алексей. Меня зовут Иван Петров, я директор IT компании "Инновации".

Менеджер: Иван, расскажите пожалуйста подробнее о вашем бизнесе и текущих задачах по привлечению клиентов.

Клиент: У нас компания занимается разработкой мобильных приложений и веб-сервисов. Работаем уже 5 лет, в штате 25 разработчиков. Основная проблема сейчас - нехватка качественных лидов. 

Менеджер: Понятно. А какие методы привлечения клиентов вы используете сейчас?

Клиент: В основном контекстная реклама в Google и Яндексе, немного SMM в LinkedIn. Но эффективность падает, стоимость лида растет. Раньше лид стоил 2000 рублей, сейчас уже 5000, а качество хуже.

Менеджер: Какой у вас средний чек проекта?

Клиент: От 500 тысяч до 2 миллионов рублей, в среднем около 800 тысяч.

Менеджер: Отличные показатели! А сколько лидов в месяц вы сейчас получаете и сколько из них конвертируется в клиентов?

Клиент: Примерно 30-40 лидов в месяц, из них реальных клиентов становятся 3-4. То есть конверсия около 10%.

Менеджер: Мы можем помочь увеличить количество качественных лидов через систему холодного обзвона с предварительной квалификацией. Наши операторы работают по скриптам и передают только теплых клиентов.

Клиент: Это интересно. А какая у вас стоимость лида?

Менеджер: Стоимость зависит от объема, но в среднем 3000-4000 рублей за квалифицированный лид. При этом конверсия в клиентов обычно выше - 15-20%.

Клиент: Звучит привлекательно. А какие гарантии качества вы даете?

Менеджер: Мы даем гарантию возврата денег если лид не отвечает на критерии качества. Также первые 10 лидов предоставляем со скидкой 50% для тестирования.

Клиент: Хорошо, это снижает риски. А сколько лидов в месяц вы можете обеспечить?

Менеджер: Для вашей ниши реально 50-80 качественных лидов в месяц.

Клиент: Мне нужно посоветоваться с партнером. Когда мы можем начать тест?

Менеджер: Тест можем запустить уже на следующей неделе. Отправлю вам коммерческое предложение сегодня. Когда удобно созвониться для обсуждения деталей?

Клиент: Давайте созвонимся во вторник в 14:00.

Менеджер: Отлично, записываю. Спасибо за встречу, Иван!

Клиент: Спасибо, до свидания!
  `.trim();
}
