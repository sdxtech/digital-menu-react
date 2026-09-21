import { Injectable } from '@nestjs/common';

type AuditPdfRow = {
  createdAt?: Date | string;
  actorName?: string;
  actorEmail?: string;
  role?: string;
  site?: string;
  module: string;
  action: string;
  success: boolean;
  details?: Record<string, unknown>;
};

@Injectable()
export class AuditPdfService {
  build(title: string, rows: AuditPdfRow[], period: string) {
    const pages: string[] = [];
    const pageSize = 25;
    for (
      let offset = 0;
      offset < Math.max(rows.length, 1);
      offset += pageSize
    ) {
      pages.push(
        this.page(title, period, rows.slice(offset, offset + pageSize), offset),
      );
    }
    return this.document(pages);
  }

  private page(
    title: string,
    period: string,
    rows: AuditPdfRow[],
    offset: number,
  ) {
    const commands: string[] = [
      'BT /F1 16 Tf 18 565 Td ' + this.text(title) + ' Tj ET',
      'BT /F1 9 Tf 18 548 Td ' + this.text(`Period: ${period}`) + ' Tj ET',
      'BT /F1 8 Tf 18 534 Td ' +
        this.text(
          `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB`,
        ) +
        ' Tj ET',
    ];
    const columns = [30, 92, 105, 70, 55, 75, 120, 48, 211];
    const headers = [
      'No',
      'Time',
      'User',
      'Role',
      'Site',
      'Module',
      'Action',
      'Status',
      'Details',
    ];
    let y = 515;
    this.tableRow(commands, y, columns, headers, true);
    y -= 18;
    rows.forEach((row, index) => {
      const actor = row.actorName || row.actorEmail || 'System';
      const details = row.details ? JSON.stringify(row.details) : '';
      this.tableRow(
        commands,
        y,
        columns,
        [
          String(offset + index + 1),
          this.formatDate(row.createdAt),
          actor,
          row.role ?? '-',
          row.site ?? '-',
          row.module,
          row.action,
          row.success ? 'Success' : 'Failed',
          details,
        ],
        false,
      );
      y -= 18;
    });
    if (!rows.length) {
      commands.push(
        'BT /F1 10 Tf 18 475 Td (No audit records in this period.) Tj ET',
      );
    }
    return commands.join('\n');
  }

  private tableRow(
    commands: string[],
    y: number,
    widths: number[],
    values: string[],
    header: boolean,
  ) {
    let x = 18;
    widths.forEach((width, index) => {
      commands.push(`${x} ${y - 4} ${width} 18 re S`);
      const maxChars = Math.max(2, Math.floor(width / 4.7));
      const value = this.truncate(values[index] ?? '', maxChars);
      commands.push(
        `BT /F1 ${header ? 7 : 6} Tf ${x + 2} ${y + 2} Td ${this.text(value)} Tj ET`,
      );
      x += width;
    });
  }

  private document(pageStreams: string[]) {
    const objects: string[] = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    const pageIds = pageStreams.map((_, index) => 4 + index * 2);
    objects.push(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    );
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    pageStreams.forEach((stream, index) => {
      const pageId = 4 + index * 2;
      const contentId = pageId + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
      const length = Buffer.byteLength(stream, 'latin1');
      objects.push(`<< /Length ${length} >>\nstream\n${stream}\nendstream`);
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }

  private text(value: string) {
    const safe = value
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
    return `(${safe})`;
  }

  private truncate(value: string, max: number) {
    return value.length > max
      ? `${value.slice(0, Math.max(1, max - 3))}...`
      : value;
  }

  private formatDate(value?: Date | string) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
