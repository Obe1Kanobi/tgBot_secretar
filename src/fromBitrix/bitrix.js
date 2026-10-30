import axios from 'axios';
import { config } from '../config.js';

class BitrixService {
  constructor() {
    this.baseUrl = config.bitrix.webhookUrl;
    this.restUrl = `${this.baseUrl}/rest/${config.bitrix.userId}/${config.bitrix.webhookKey}`;
  }

  // Обновление лида результатами анализа встречи
  async updateLead(leadId, analysisResult, transcript, meetingUrl, logger) {
    try {
      logger.info({ leadId }, 'Updating Bitrix lead with meeting analysis');

      // Формируем данные для обновления лида
      const updateData = {
        ID: leadId,
        fields: {
          // Обновляем комментарий с результатами анализа
          COMMENTS: this.formatLeadComment(analysisResult, transcript, meetingUrl),

          // Устанавливаем стадию в зависимости от категории клиента
          STATUS_ID: this.getStatusByCategory(analysisResult.category),

          // Добавляем общую оценку встречи в пользовательское поле
          'UF_CRM_MEETING_SCORE': analysisResult.overallScore,

          // Категория клиента
          'UF_CRM_CLIENT_CATEGORY': analysisResult.category,

          // Дата последней встречи
          'UF_CRM_LAST_MEETING': new Date().toISOString(),
        }
      };

      // Обновляем лид
      const response = await axios.post(`${this.restUrl}/crm.lead.update/`, updateData);

      if (response.data.result) {
        logger.info({ leadId }, 'Lead updated successfully in Bitrix');

        // Добавляем активность (комментарий) к лиду
        await this.addLeadActivity(leadId, analysisResult, meetingUrl, logger);

        return { success: true, leadId };
      } else {
        throw new Error(response.data.error_description || 'Unknown Bitrix error');
      }

    } catch (error) {
      logger.error({
        leadId,
        error: error.message,
        response: error.response?.data
      }, 'Failed to update Bitrix lead');

      throw new Error(`Bitrix update failed: ${error.message}`);
    }
  }

  // Добавление активности к лиду
  async addLeadActivity(leadId, analysisResult, meetingUrl, logger) {
    try {
      const activityData = {
        fields: {
          OWNER_TYPE_ID: 1, // Лид
          OWNER_ID: leadId,
          TYPE_ID: 4, // Встреча
          SUBJECT: 'Анализ встречи через Meeting Bot',
          DESCRIPTION: this.formatActivityDescription(analysisResult, meetingUrl),
          COMPLETED: 'Y',
          PRIORITY: this.getPriorityByCategory(analysisResult.category),
          RESPONSIBLE_ID: config.bitrix.responsibleId || 1,
          START_TIME: new Date().toISOString(),
          END_TIME: new Date().toISOString()
        }
      };

      const response = await axios.post(`${this.restUrl}/crm.activity.add/`, activityData);

      if (response.data.result) {
        logger.info({ leadId, activityId: response.data.result }, 'Activity added to lead');
        return response.data.result;
      }

    } catch (error) {
      logger.error({ leadId, error: error.message }, 'Failed to add activity to lead');
    }
  }

  // Создание дела по результатам встречи
  async createTask(leadId, analysisResult, logger) {
    try {
      const taskTitle = `Обработка лида после встречи - ${analysisResult.category} категория`;
      const taskDescription = this.formatTaskDescription(analysisResult);

      const taskData = {
        fields: {
          TITLE: taskTitle,
          DESCRIPTION: taskDescription,
          RESPONSIBLE_ID: config.bitrix.responsibleId || 1,
          PRIORITY: this.getPriorityByCategory(analysisResult.category),
          DEADLINE: this.getDeadlineByCategory(analysisResult.category),
          UF_CRM_TASK: [`L_${leadId}`], // Привязка к лиду
          GROUP_ID: config.bitrix.projectId || null
        }
      };

      const response = await axios.post(`${this.restUrl}/tasks.task.add/`, taskData);

      if (response.data.result?.task?.id) {
        logger.info({
          leadId,
          taskId: response.data.result.task.id
        }, 'Task created for lead');

        return response.data.result.task.id;
      }

    } catch (error) {
      logger.error({ leadId, error: error.message }, 'Failed to create task');
    }
  }

  // Получение информации о лиде
  async getLead(leadId, logger) {
    try {
      const response = await axios.get(`${this.restUrl}/crm.lead.get/?id=${leadId}`);

      if (response.data.result) {
        return response.data.result;
      } else {
        throw new Error('Lead not found');
      }

    } catch (error) {
      logger.error({ leadId, error: error.message }, 'Failed to get lead from Bitrix');
      throw error;
    }
  }

  // Форматирование комментария для лида
  formatLeadComment(analysisResult, transcript, meetingUrl) {
    const date = new Date().toLocaleString('ru-RU');

    return `
🤖 АНАЛИЗ ВСТРЕЧИ (${date})

🔗 Ссылка встречи: ${meetingUrl}
⭐ Общая оценка: ${analysisResult.overallScore}/100
🏷️ Категория клиента: ${analysisResult.category}

📊 ДЕТАЛЬНАЯ ОЦЕНКА:
${Object.entries(analysisResult.points || {}).map(([key, value]) =>
  `${key}. ${value.score}/10 - ${value.comment}`
).join('\n')}

💡 РЕЗЮМЕ:
${analysisResult.summary}

📝 РЕКОМЕНДАЦИИ:
${this.getRecommendationsByCategory(analysisResult.category)}

Транскрипт встречи сохранен в системе.
    `.trim();
  }

  // Форматирование описания активности
  formatActivityDescription(analysisResult, meetingUrl) {
    return `
Проведен автоматический анализ встречи через Meeting Bot.

Результаты анализа:
- Общая оценка: ${analysisResult.overallScore}/100
- Категория клиента: ${analysisResult.category}
- Ссылка встречи: ${meetingUrl}

Резюме: ${analysisResult.summary}

Подробный отчет добавлен в комментарии к лиду.
    `.trim();
  }

  // Форматирование описания задачи
  formatTaskDescription(analysisResult) {
    const actions = this.getActionsByCategory(analysisResult.category);

    return `
Обработка лида после анализа встречи:

Категория клиента: ${analysisResult.category}
Общая оценка: ${analysisResult.overallScore}/100

НЕОБХОДИМЫЕ ДЕЙСТВИЯ:
${actions.map(action => `• ${action}`).join('\n')}

Резюме встречи: ${analysisResult.summary}
    `.trim();
  }

  // Получение статуса по категории клиента
  getStatusByCategory(category) {
    const statusMap = {
      'A': 'IN_PROCESS', // Горячий - в работе
      'B': 'PROCESSED',  // Теплый - обработан
      'C': 'JUNK'        // Холодный - отказ
    };

    return statusMap[category] || 'NEW';
  }

  // Получение приоритета по категории
  getPriorityByCategory(category) {
    const priorityMap = {
      'A': '2', // Высокий
      'B': '1', // Средний
      'C': '0'  // Низкий
    };

    return priorityMap[category] || '1';
  }

  // Получение дедлайна по категории
  getDeadlineByCategory(category) {
    const now = new Date();
    const deadlineMap = {
      'A': 1, // Горячий - 1 день
      'B': 3, // Теплый - 3 дня
      'C': 7  // Холодный - 7 дней
    };

    const days = deadlineMap[category] || 3;
    now.setDate(now.getDate() + days);

    return now.toISOString().split('T')[0];
  }

  // Получение рекомендаций по категории
  getRecommendationsByCategory(category) {
    const recommendations = {
      'A': [
        '✅ Срочно подготовить коммерческое предложение',
        '📞 Назначить повторную встречу в течение 1-2 дней',
        '💰 Подготовить индивидуальные условия сотрудничества',
        '🎯 Проработать возражения и детали внедрения'
      ],
      'B': [
        '📋 Отправить презентацию услуг',
        '📞 Запланировать звонок через неделю',
        '💡 Подготовить кейсы релевантных проектов',
        '🤝 Обсудить пилотный проект'
      ],
      'C': [
        '📧 Добавить в базу для email-рассылки',
        '⏰ Запланировать повторный контакт через месяц',
        '📚 Отправить полезные материалы',
        '🎯 Определить причины отказа для улучшения подхода'
      ]
    };

    return recommendations[category]?.join('\n') || 'Стандартная обработка лида';
  }

  // Получение действий по категории
  getActionsByCategory(category) {
    const actions = {
      'A': [
        'Подготовить персональное КП в течение дня',
        'Назначить встречу с руководителем',
        'Проработать техническое задание',
        'Подготовить договор'
      ],
      'B': [
        'Отправить презентацию компании',
        'Запланировать звонок через 3-5 дней',
        'Подготовить кейсы аналогичных проектов',
        'Обсудить возможность пилотного проекта'
      ],
      'C': [
        'Добавить в систему nurturing',
        'Запланировать повторный контакт через 30 дней',
        'Проанализировать причины отказа',
        'Обновить подход для аналогичных клиентов'
      ]
    };

    return actions[category] || ['Обработать лид согласно стандартному процессу'];
  }
}

export const bitrixService = new BitrixService();
