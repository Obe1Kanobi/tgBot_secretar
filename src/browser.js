import puppeteer from 'puppeteer';
import { config } from './config.js';

// page.waitForTimeout удалён в Puppeteer 22+, используем свою задержку
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openMeeting({ url, logger }) {
  // Валидация URL
  try {
    new URL(url);
  } catch (e) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Определяем тип платформы встреч
  const platform = detectMeetingPlatform(url);
  logger.info({ url, platform }, 'Определена платформа встречи');

  const browser = await puppeteer.launch({
    executablePath: config.chromiumPath,
    headless: false, // Изменено на false для отладки
    defaultViewport: { width: 1280, height: 800 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--window-size=1280,800',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=site-per-process',
      '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();

  // Устанавливаем user-agent
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Эмулируем человеческое поведение
  await page.setViewport({ width: 1280, height: 800 });
  
  // Отключаем детекцию webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Подменяем другие признаки автоматизации
    window.chrome = {
      runtime: {}
    };
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
  });

  logger.info({ url }, 'Открытие страницы встречи...');
  
  try {
    // Выдаём странице разрешения на микрофон/камеру через API Puppeteer
    // (сырой CDP Browser.grantPermissions требует другие имена: audioCapture и т.п.)
    await browser.defaultBrowserContext().overridePermissions(
      new URL(url).origin,
      ['microphone', 'camera', 'notifications']
    );

    // Переходим на страницу встречи
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 90000 
    });

    // Ждем загрузки страницы
    await sleep(5000);

    // Выполняем логику присоединения в зависимости от платформы
    switch (platform) {
      case 'zoom':
        await joinZoomMeeting(page, logger);
        break;
      case 'meet':
        await joinGoogleMeeting(page, logger);
        break;
      case 'teams':
        await joinTeamsMeeting(page, logger);
        break;
      case 'telemost':
        await joinTelemostMeeting(page, logger);
        break;
      case 'contour':
        await joinContourMeeting(page, logger);
        break;
      default:
        await joinGenericMeeting(page, logger);
    }

    // Настраиваем запись звука
    await setupAudioCapture(page, logger);

    logger.info('Успешно присоединились к встрече');
    return { browser, page };

  } catch (error) {
    logger.error({ error: error.message }, 'Не удалось присоединиться к встрече');
    await browser.close();
    throw new Error(`Failed to join meeting: ${error.message}`);
  }
}

function detectMeetingPlatform(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  
  if (hostname.includes('zoom')) return 'zoom';
  if (hostname.includes('meet.google') || hostname.includes('meet.google.com')) return 'meet';
  if (hostname.includes('teams.microsoft') || hostname.includes('teams.live.com')) return 'teams';
  if (hostname.includes('telemost.yandex')) return 'telemost';
  if (hostname.includes('talk.contour.ru')) return 'contour';
  
  return 'generic';
}

async function joinZoomMeeting(page, logger) {
  try {
    logger.info('Присоединение к Zoom встрече...');
    
    // Ждем кнопку "Join from Your Browser"
    try {
      await page.waitForSelector('a[href*="wc/join"]', { timeout: 10000 });
      await page.click('a[href*="wc/join"]');
      logger.info('Нажата кнопка "Join from Browser" для Zoom');
      await sleep(3000);
    } catch (e) {
      logger.warn('Ссылка на браузерное подключение не найдена, продолжаем...');
    }

    // Вводим имя участника
    try {
      await page.waitForSelector('#inputname', { timeout: 5000 });
      await page.type('#inputname', 'Meeting Bot');
      logger.info('Введено имя участника');
    } catch (e) {
      logger.warn('Поле ввода имени не найдено');
    }

    // Кликаем кнопку присоединения
    const joinSelectors = [
      'button[type="submit"]',
      'button:contains("Join")',
      'button:contains("Войти")',
      'input[value*="Join"]',
      '.join-dialog button',
      '[data-testid="join-button"]'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Нажата кнопка присоединения Zoom: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!joined) {
      // Попытка через JavaScript
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
        const joinButton = buttons.find(btn => 
          btn.textContent && btn.textContent.match(/join|войти|присоединиться/i) ||
          btn.value && btn.value.match(/join|войти|присоединиться/i)
        );
        if (joinButton) joinButton.click();
      });
      logger.info('Использован JavaScript fallback для присоединения к Zoom');
    }

    await sleep(8000);

    // Отключаем микрофон и камеру в Zoom
    try {
      const muteButton = await page.waitForSelector('button[aria-label*="Mute"], button[aria-label*="mute"]', { timeout: 5000 });
      if (muteButton) {
        await muteButton.click();
        logger.info('Микрофон отключён в Zoom');
      }
    } catch (e) {
      logger.warn('Не удалось отключить микрофон в Zoom');
    }

    try {
      const videoButton = await page.waitForSelector('button[aria-label*="camera"], button[aria-label*="video"]', { timeout: 5000 });
      if (videoButton) {
        await videoButton.click();
        logger.info('Камера отключена в Zoom');
      }
    } catch (e) {
      logger.warn('Не удалось отключить камеру в Zoom');
    }

  } catch (error) {
    throw new Error(`Zoom meeting join failed: ${error.message}`);
  }
}

async function joinGoogleMeeting(page, logger) {
  try {
    logger.info('Присоединение к Google Meet...');

    // Отключаем микрофон и камеру до присоединения
    try {
      await page.waitForSelector('[data-testid="mic-button"], [aria-label*="microphone"]', { timeout: 5000 });
      const micButton = await page.$('[data-testid="mic-button"], [aria-label*="microphone"]');
      if (micButton) {
        const isMuted = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'true', micButton);
        if (!isMuted) {
          await micButton.click();
          logger.info('Микрофон отключён перед присоединением к Google Meet');
        }
      }
    } catch (e) {
      logger.warn('Не удалось найти кнопку микрофона перед присоединением');
    }

    try {
      await page.waitForSelector('[data-testid="camera-button"], [aria-label*="camera"]', { timeout: 5000 });
      const cameraButton = await page.$('[data-testid="camera-button"], [aria-label*="camera"]');
      if (cameraButton) {
        const isCameraOff = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'false', cameraButton);
        if (!isCameraOff) {
          await cameraButton.click();
          logger.info('Камера отключена перед присоединением к Google Meet');
        }
      }
    } catch (e) {
      logger.warn('Не удалось найти кнопку камеры перед присоединением');
    }

    // Присоединяемся к встрече
    const joinSelectors = [
      '[data-testid="join-button"]',
      'button[jsname="Qx7uuf"]',
      'button:contains("Join now")',
      'button:contains("Присоединиться")',
      '.google-material-icons:contains("videocam") ~ span:contains("Join")',
      '[aria-label*="Join"]'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Нажата кнопка присоединения Google Meet: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!joined) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const joinButton = buttons.find(btn => 
          btn.textContent && btn.textContent.match(/join|присоединиться/i)
        );
        if (joinButton) joinButton.click();
      });
      logger.info('Использован JavaScript fallback для присоединения к Google Meet');
    }

    await sleep(8000);

  } catch (error) {
    throw new Error(`Google Meet join failed: ${error.message}`);
  }
}

async function joinTeamsMeeting(page, logger) {
  try {
    logger.info('Присоединение к Microsoft Teams...');

    // Выбираем "Join on the web instead"
    try {
      await page.waitForSelector('a[href*="launcher/launcher.html"]', { timeout: 10000 });
      await page.click('a[href*="launcher/launcher.html"]');
      logger.info('Нажата кнопка "Join on the web" для Teams');
      await sleep(3000);
    } catch (e) {
      logger.warn('Ссылка на веб-подключение не найдена для Teams');
    }

    // Вводим имя
    try {
      await page.waitForSelector('#displayName', { timeout: 5000 });
      await page.type('#displayName', 'Meeting Bot');
      logger.info('Введено имя для Teams');
    } catch (e) {
      logger.warn('Поле ввода имени не найдено для Teams');
    }

    // Отключаем камеру и микрофон
    try {
      const micToggle = await page.waitForSelector('[data-tid="toggle-mute"]', { timeout: 3000 });
      if (micToggle) {
        await micToggle.click();
        logger.info('Микрофон отключён в Teams');
      }
    } catch (e) {
      logger.warn('Не удалось отключить микрофон в Teams');
    }

    try {
      const cameraToggle = await page.waitForSelector('[data-tid="toggle-video"]', { timeout: 3000 });
      if (cameraToggle) {
        await cameraToggle.click();
        logger.info('Камера отключена в Teams');
      }
    } catch (e) {
      logger.warn('Не удалось отключить камеру в Teams');
    }

    // Присоединяемся
    const joinSelectors = [
      '[data-tid="prejoin-join-button"]',
      'button[aria-label*="Join now"]',
      'button:contains("Join now")',
      'button:contains("Присоединиться")'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Нажата кнопка присоединения Teams: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    await sleep(8000);

  } catch (error) {
    throw new Error(`Teams meeting join failed: ${error.message}`);
  }
}

async function joinTelemostMeeting(page, logger) {
  try {
    logger.info('Присоединение к Yandex Telemost...');

    // Вводим имя участника.
    // ID вида react-aria...-:r8: случайные при каждой загрузке — опираемся на data-testid
    try {
      const nameInput = await page.waitForSelector('[data-testid="orb-textinput-input"]', { timeout: 10000 });
      // В поле уже подставлено «Гость» — выделяем всё тройным кликом и печатаем поверх
      await nameInput.click({ clickCount: 3 });
      await nameInput.type('Meeting Bot');
      logger.info('Введено имя для Telemost');
    } catch (e) {
      logger.warn('Поле ввода имени не найдено для Telemost');
    }

    // Присоединяемся: ищем кнопку по тексту
    // (селекторы button:contains(...) в Puppeteer не работают — это jQuery-синтаксис)
    let joined = false;
    try {
      joined = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = buttons.find(b =>
          b.textContent && /подключиться|присоединиться|войти|continue|join/i.test(b.textContent)
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
    } catch (e) {
      logger.warn({ error: e.message }, 'Поиск кнопки присоединения Telemost не удался');
    }

    if (joined) {
      logger.info('Нажата кнопка присоединения Telemost');
    } else {
      logger.warn('Кнопка присоединения Telemost не найдена');
    }

    await sleep(8000);

    // Отключаем микрофон в Телемосте
    try {
      const micButton = await page.waitForSelector('[title*="микрофон"], [aria-label*="микрофон"]', { timeout: 5000 });
      if (micButton) {
        await micButton.click();
        logger.info('Микрофон отключён в Telemost');
      }
    } catch (e) {
      logger.warn('Не удалось отключить микрофон в Telemost');
    }

  } catch (error) {
    throw new Error(`Telemost meeting join failed: ${error.message}`);
  }
}

async function joinContourMeeting(page, logger) {
  try {
    logger.info('Присоединение к Contour Talk...');

    // Вводим имя участника
    try {
      await page.waitForSelector('input[name="name"], input[placeholder*="имя"]', { timeout: 5000 });
      await page.type('input[name="name"], input[placeholder*="имя"]', 'Meeting Bot');
      logger.info('Введено имя для Contour');
    } catch (e) {
      logger.warn('Поле ввода имени не найдено для Contour');
    }

    // Присоединяемся к встрече
    const joinSelectors = [
      'button:contains("Войти в конференцию")',
      'button:contains("Войти")',
      'button:contains("Присоединиться")',
      'button[type="submit"]'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Нажата кнопка присоединения Contour: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    await sleep(10000);

  } catch (error) {
    throw new Error(`Contour meeting join failed: ${error.message}`);
  }
}

async function joinGenericMeeting(page, logger) {
  try {
    logger.info('Присоединение к обычной встрече...');

    // Универсальные селекторы для присоединения
    const joinSelectors = [
      'button[data-join="true"]',
      'button:contains("Join")',
      'button:contains("Присоединиться")',
      'button:contains("Войти")',
      'div[role="button"]:contains("Join")',
      'div[role="button"]:contains("Присоединиться")',
      'button[aria-label*="Join"]',
      'button[aria-label*="join"]',
      'button[aria-label*="Присоединиться"]',
      'button[title*="Join"]',
      'button[title*="Присоединиться"]',
      'input[value*="Join"]',
      'input[value*="Войти"]'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Нажата кнопка присоединения: ${selector}`);
        joined = true;
        await sleep(3000);
        break;
      } catch (e) {
        continue;
      }
    }

    if (!joined) {
      // Попытка через JavaScript
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input, a'));
        const joinButton = buttons.find(btn => 
          (btn.textContent && btn.textContent.match(/join|присоединиться|войти/i)) ||
          (btn.value && btn.value.match(/join|присоединиться|войти/i)) ||
          (btn.title && btn.title.match(/join|присоединиться|войти/i))
        );
        if (joinButton) joinButton.click();
      });
      logger.info('Использован JavaScript fallback для присоединения');
    }

    await sleep(8000);

  } catch (error) {
    logger.warn(`Проблемы при присоединении к встрече: ${error.message}`);
  }
}

async function setupAudioCapture(page, logger) {
  try {
    // Настраиваем захват аудио на странице
    await page.evaluate(() => {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .then(stream => {
            console.log('Audio stream captured successfully');
            window.audioStream = stream;
          })
          .catch(err => console.log('Audio capture error:', err));
      }
    });

    logger.info('Настройка захвата аудио завершена');
  } catch (error) {
    logger.warn(`Настройка захвата аудио не удалась: ${error.message}`);
  }
}
