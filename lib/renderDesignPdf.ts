import { PDFDocument } from "pdf-lib";

export async function renderDesignReportPdf(data: any): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();
  page.drawText("Rapport Mensuel", { x: 50, y: height - 50, size: 24 });
  return await pdfDoc.save();
}
