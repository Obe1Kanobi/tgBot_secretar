import puppeteer from 'puppeteer';
import { config } from './config.js';

export async function openMeeting({ url, logger }) {
  // Валидация URL
  try {
    new URL(url);
  } catch (e) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Определяем тип платформы встреч
  const platform = detectMeetingPlatform(url);
  logger.info({ url, platform }, 'Detected meeting platform');

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
      '--allow-file-access-from-files',
      '--disable-extensions-except=/path/to/extension',
      '--load-extension=/path/to/extension'
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

  logger.info({ url }, 'Opening meeting page...');
  
  try {
    // Настраиваем разрешения через CDP
    const client = await page.createCDPSession();
    
    await client.send('Browser.grantPermissions', {
      origin: new URL(url).origin,
      permissions: ['microphone', 'camera', 'notifications']
    });

    // Переходим на страницу встречи
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 90000 
    });

    // Ждем загрузки страницы
    await page.waitForTimeout(5000);

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

    logger.info('Successfully joined the meeting');
    return { browser, page };

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to join meeting');
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
    logger.info('Joining Zoom meeting...');
    
    // Ждем кнопку "Join from Your Browser"
    try {
      await page.waitForSelector('a[href*="wc/join"]', { timeout: 10000 });
      await page.click('a[href*="wc/join"]');
      logger.info('Clicked "Join from Browser" for Zoom');
      await page.waitForTimeout(3000);
    } catch (e) {
      logger.warn('Browser join link not found, continuing...');
    }

    // Вводим имя участника
    try {
      await page.waitForSelector('#inputname', { timeout: 5000 });
      await page.type('#inputname', 'Meeting Bot');
      logger.info('Entered participant name');
    } catch (e) {
      logger.warn('Name input not found');
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
        logger.info(`Clicked Zoom join button: ${selector}`);
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
      logger.info('Used JavaScript fallback for Zoom join');
    }

    await page.waitForTimeout(8000);

    // Отключаем микрофон и камеру в Zoom
    try {
      const muteButton = await page.waitForSelector('button[aria-label*="Mute"], button[aria-label*="mute"]', { timeout: 5000 });
      if (muteButton) {
        await muteButton.click();
        logger.info('Muted microphone in Zoom');
      }
    } catch (e) {
      logger.warn('Could not mute microphone in Zoom');
    }

    try {
      const videoButton = await page.waitForSelector('button[aria-label*="camera"], button[aria-label*="video"]', { timeout: 5000 });
      if (videoButton) {
        await videoButton.click();
        logger.info('Disabled camera in Zoom');
      }
    } catch (e) {
      logger.warn('Could not disable camera in Zoom');
    }

  } catch (error) {
    throw new Error(`Zoom meeting join failed: ${error.message}`);
  }
}

async function joinGoogleMeeting(page, logger) {
  try {
    logger.info('Joining Google Meet...');

    // Отключаем микрофон и камеру до присоединения
    try {
      await page.waitForSelector('[data-testid="mic-button"], [aria-label*="microphone"]', { timeout: 5000 });
      const micButton = await page.$('[data-testid="mic-button"], [aria-label*="microphone"]');
      if (micButton) {
        const isMuted = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'true', micButton);
        if (!isMuted) {
          await micButton.click();
          logger.info('Muted microphone before joining Google Meet');
        }
      }
    } catch (e) {
      logger.warn('Could not find microphone button before joining');
    }

    try {
      await page.waitForSelector('[data-testid="camera-button"], [aria-label*="camera"]', { timeout: 5000 });
      const cameraButton = await page.$('[data-testid="camera-button"], [aria-label*="camera"]');
      if (cameraButton) {
        const isCameraOff = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'false', cameraButton);
        if (!isCameraOff) {
          await cameraButton.click();
          logger.info('Disabled camera before joining Google Meet');
        }
      }
    } catch (e) {
      logger.warn('Could not find camera button before joining');
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
        logger.info(`Clicked Google Meet join button: ${selector}`);
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
      logger.info('Used JavaScript fallback for Google Meet join');
    }

    await page.waitForTimeout(8000);

  } catch (error) {
    throw new Error(`Google Meet join failed: ${error.message}`);
  }
}

async function joinTeamsMeeting(page, logger) {
  try {
    logger.info('Joining Microsoft Teams...');

    // Выбираем "Join on the web instead"
    try {
      await page.waitForSelector('a[href*="launcher/launcher.html"]', { timeout: 10000 });
      await page.click('a[href*="launcher/launcher.html"]');
      logger.info('Clicked "Join on the web" for Teams');
      await page.waitForTimeout(3000);
    } catch (e) {
      logger.warn('Web join link not found for Teams');
    }

    // Вводим имя
    try {
      await page.waitForSelector('#displayName', { timeout: 5000 });
      await page.type('#displayName', 'Meeting Bot');
      logger.info('Entered name for Teams');
    } catch (e) {
      logger.warn('Name input not found for Teams');
    }

    // Отключаем камеру и микрофон
    try {
      const micToggle = await page.waitForSelector('[data-tid="toggle-mute"]', { timeout: 3000 });
      if (micToggle) {
        await micToggle.click();
        logger.info('Muted microphone in Teams');
      }
    } catch (e) {
      logger.warn('Could not mute microphone in Teams');
    }

    try {
      const cameraToggle = await page.waitForSelector('[data-tid="toggle-video"]', { timeout: 3000 });
      if (cameraToggle) {
        await cameraToggle.click();
        logger.info('Disabled camera in Teams');
      }
    } catch (e) {
      logger.warn('Could not disable camera in Teams');
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
        logger.info(`Clicked Teams join button: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    await page.waitForTimeout(8000);

  } catch (error) {
    throw new Error(`Teams meeting join failed: ${error.message}`);
  }
}

async function joinTelemostMeeting(page, logger) {
  try {
    logger.info('Joining Yandex Telemost...');

    // Вводим имя участника
    try {
      await page.waitForSelector('input[placeholder*="имя"], input[placeholder*="name"]', { timeout: 5000 });
      await page.type('input[placeholder*="имя"], input[placeholder*="name"]', 'Meeting Bot');
      logger.info('Entered name for Telemost');
    } catch (e) {
      logger.warn('Name input not found for Telemost');
    }

    // Присоединяемся к встрече
    const joinSelectors = [
      'button:contains("Войти")',
      'button:contains("Присоединиться")',
      'button[type="submit"]',
      '.join-button'
    ];

    let joined = false;
    for (const selector of joinSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        logger.info(`Clicked Telemost join button: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    await page.waitForTimeout(8000);

    // Отключаем микрофон
    try {
      const micButton = await page.waitForSelector('[title*="микрофон"], [aria-label*="микрофон"]', { timeout: 5000 });
      if (micButton) {
        await micButton.click();
        logger.info('Muted microphone in Telemost');
      }
    } catch (e) {
      logger.warn('Could not mute microphone in Telemost');
    }

  } catch (error) {
    throw new Error(`Telemost meeting join failed: ${error.message}`);
  }
}

async function joinContourMeeting(page, logger) {
  try {
    logger.info('Joining Contour Talk...');

    // Вводим имя участника
    try {
      await page.waitForSelector('input[name="name"], input[placeholder*="имя"]', { timeout: 5000 });
      await page.type('input[name="name"], input[placeholder*="имя"]', 'Meeting Bot');
      logger.info('Entered name for Contour');
    } catch (e) {
      logger.warn('Name input not found for Contour');
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
        logger.info(`Clicked Contour join button: ${selector}`);
        joined = true;
        break;
      } catch (e) {
        continue;
      }
    }

    await page.waitForTimeout(10000);

  } catch (error) {
    throw new Error(`Contour meeting join failed: ${error.message}`);
  }
}

async function joinGenericMeeting(page, logger) {
  try {
    logger.info('Joining generic meeting...');

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
        logger.info(`Clicked generic join button: ${selector}`);
        joined = true;
        await page.waitForTimeout(3000);
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
      logger.info('Used JavaScript fallback for generic meeting');
    }

    await page.waitForTimeout(8000);

  } catch (error) {
    logger.warn(`Generic meeting join had issues: ${error.message}`);
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

    logger.info('Audio capture setup completed');
  } catch (error) {
    logger.warn(`Audio capture setup failed: ${error.message}`);
  }
}
