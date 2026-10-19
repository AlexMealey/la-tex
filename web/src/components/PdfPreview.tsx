import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const PAPER_SIZES = [
  { label: 'A4', w: 595.28, h: 841.89 },
  { label: 'Letter', w: 612, h: 792 },
  { label: 'Legal', w: 612, h: 1008 },
  { label: 'A5', w: 419.53, h: 595.28 },
  { label: 'A3', w: 841.89, h: 1190.55 },
];

function describePageSize(widthPt: number, heightPt: number) {
  const [short, long] = [Math.min(widthPt, heightPt), Math.max(widthPt, heightPt)];
  const match = PAPER_SIZES.find((p) => Math.abs(p.w - short) < 2 && Math.abs(p.h - long) < 2);
  const mm = (pt: number) => Math.round((pt * 25.4) / 72);
  return { label: match?.label ?? 'Custom', dims: `${mm(widthPt)} × ${mm(heightPt)} mm`, isA4: match?.label === 'A4' };
}

export default function PdfPreview({ url }: { url: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [size, setSize] = useState<ReturnType<typeof describePageSize> | null>(null);
  // Keep the reading position when the PDF is replaced by a recompile.
  const savedScroll = useRef(0);
  const restoring = useRef(false);
  const rendered = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    restoring.current = true;
    rendered.current = 0;
  }, [url]);

  const onPageRendered = () => {
    rendered.current += 1;
    if (restoring.current && rendered.current >= numPages && scrollRef.current) {
      scrollRef.current.scrollTop = savedScroll.current;
      restoring.current = false;
    }
  };

  const pageWidth = Math.max(100, (width - 32) * zoom);

  return (
    <div className="pdf-preview">
      <div className="pdf-toolbar">
        {size && (
          <span className={`page-badge${size.isA4 ? ' ok' : ' warn'}`} title="Paper size of page 1">
            {size.label} · {size.dims}
          </span>
        )}
        {numPages > 0 && (
          <span className="muted small">
            {numPages} page{numPages === 1 ? '' : 's'}
          </span>
        )}
        <div className="spacer" />
        <button className="btn small ghost" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}>
          −
        </button>
        <button className="btn small ghost" onClick={() => setZoom(1)} title="Fit width">
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn small ghost" onClick={() => setZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)))}>
          +
        </button>
      </div>
      <div
        className="pdf-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          if (!restoring.current) savedScroll.current = e.currentTarget.scrollTop;
        }}
      >
        {!url ? (
          <div className="placeholder">Compile the project to see the PDF.</div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={() => (restoring.current = false)}
            loading={<div className="placeholder">Loading PDF…</div>}
            error={<div className="placeholder">No PDF was produced. Check the log for errors.</div>}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i}
                className="pdf-page"
                pageNumber={i + 1}
                width={pageWidth}
                onLoadSuccess={
                  i === 0
                    ? (page) => {
                        const [x0, y0, x1, y1] = page.view;
                        setSize(describePageSize(x1 - x0, y1 - y0));
                      }
                    : undefined
                }
                onRenderSuccess={onPageRendered}
              />
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
