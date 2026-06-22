const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class SettingsService {
  constructor() {
    this.cache = null;
  }

  async load() {
    try {
      this.cache = await prisma.systemSettings.findUnique({ where: { id: 1 } });
      if (!this.cache) {
        this.cache = await prisma.systemSettings.create({
          data: {
            id: 1,
            workingHoursStart: 9,
            workingHoursEnd: 18,
            workingDays: '1,2,3,4,5,6',
            holidays: JSON.stringify([
              '01-01','01-06','03-23','04-02','04-03','05-01','05-18',
              '06-08','06-15','06-29','07-20','08-07','08-17',
              '10-12','11-02','11-16','12-08','12-25'
            ]),
            timezone: 'America/Bogota',
            closedForLunch: false,
          }
        });
      }
      logger.info('⚙️ SystemSettings cargados en cache.');
    } catch (error) {
      logger.error('Error cargando SystemSettings:', error);
      this.cache = {
        workingHoursStart: 9,
        workingHoursEnd: 18,
        workingDays: '1,2,3,4,5,6',
        holidays: JSON.stringify(['01-01','04-03','05-01','12-25']),
        closedForLunch: false,
      };
    }
  }

  get() {
    return this.cache || {
      workingHoursStart: 9,
      workingHoursEnd: 18,
      workingDays: '1,2,3,4,5,6',
      holidays: '[]',
      closedForLunch: false,
    };
  }

  async update(data) {
    this.cache = await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return this.cache;
  }

  async getBranchSchedule(branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        useGlobalSchedule: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        workingDays: true,
        closedForLunch: true,
        lunchStart: true,
        lunchEnd: true,
      },
    });
    return branch;
  }

  async updateBranchSchedule(branchId, data) {
    const branch = await prisma.branch.update({
      where: { id: branchId },
      data,
    });
    return branch;
  }
}

module.exports = new SettingsService();
