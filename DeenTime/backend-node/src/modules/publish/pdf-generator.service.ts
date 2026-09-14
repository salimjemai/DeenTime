import { Injectable } from '@nestjs/common';
import { parseSalah, timeOnlyFromDb, type PdfOrientation, type PdfSize } from '../../common/json.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { criteriaToCalculatorInput } from '../organizations/organization.mapper.js';
import { hijriAnchorsFromMaps, MISSING_CRITERIA_MESSAGE, monthlyPeriod, ramadanPeriod, renderSchedulePdf, type PdfIqamaEntry, type SchedulePeriod } from './pdf-generator.js';

/** QuestPdfGenerator's data access (IPdfGenerator); the layout lives in pdf-generator.ts. */
@Injectable()
export class PdfGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  generateMonthlyPdf(organizationId: string, year: number, month: number, size: PdfSize, orientation: PdfOrientation): Promise<Buffer> {
    return this.generate(organizationId, monthlyPeriod(year, month), size, orientation);
  }

  async generateRamadanPdf(organizationId: string, year: number, size: PdfSize, orientation: PdfOrientation): Promise<Buffer> {
    const maps = await this.prisma.hijriMonthMap.findMany({ where: { organizationId, year } });
    return this.generate(organizationId, ramadanPeriod(year, hijriAnchorsFromMaps(maps)), size, orientation);
  }

  private async generate(organizationId: string, period: SchedulePeriod, size: PdfSize, orientation: PdfOrientation): Promise<Buffer> {
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId }, include: { criteria: true, design: true } });
    if (!organization) throw new Error('Sequence contains no elements.');
    if (!organization.criteria) throw new Error(MISSING_CRITERIA_MESSAGE);
    const start = new Date(Math.min(...period.dates.map((date) => date.getTime())));
    const end = new Date(Math.max(...period.dates.map((date) => date.getTime())));
    const iqamaEntries = await this.prisma.iqamaEntry.findMany({ where: { organizationId, date: { lte: end } }, orderBy: { date: 'asc' } });
    const maps = await this.prisma.hijriMonthMap.findMany({
      where: { organizationId, year: { gte: start.getUTCFullYear(), lte: end.getUTCFullYear() } },
    });
    return renderSchedulePdf({
      organization: {
        name: organization.name,
        addressLine: organization.addressLine,
        city: organization.city,
        state: organization.state,
        zipCode: organization.zipCode,
        phone: organization.phone,
        email: organization.email,
        websiteUrl: organization.websiteUrl,
      },
      design: organization.design ? { iqamaHeadings: organization.design.iqamaHeadings, footerHtml: organization.design.footerHtml } : null,
      criteria: criteriaToCalculatorInput(organization.criteria),
      iqamaEntries: iqamaEntries.flatMap((row): PdfIqamaEntry[] => {
        const salah = parseSalah(row.salah);
        return salah === null ? [] : [{ date: row.date, salah, time: timeOnlyFromDb(row.time), offsetMinutes: row.offsetMinutes }];
      }),
      hijriAnchors: hijriAnchorsFromMaps(maps),
      period,
      size,
      orientation,
    });
  }
}
