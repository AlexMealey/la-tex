import { redo, toggleComment, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  ALIGNMENTS,
  HEADINGS,
  HIGHLIGHT_COLORS,
  LISTS,
  MATH_TEMPLATES,
  SCRIPTS,
  SYMBOL_GROUPS,
  TEXT_COLORS,
  clearFormatting,
  heading,
  indentItems,
  insertLabel,
  insertMath,
  insertRef,
  insertSymbol,
  insertTable,
  labelsIn,
  linkAt,
  outdentItems,
  packageLine,
  removeLink,
  setAlignment,
  setColor,
  setLink,
  setSize,
  toggleCommand,
  toggleList,
  wrap,
  type MathTemplate,
  type Package,
  type Swatch,
} from '../latexCommands';
import { SIZES, findEnv, findGroup, type FormatContext } from '../latexContext';
import Icon, { type IconName } from './icons';
import Popover from './Popover';

interface Props {
  getView: () => EditorView | null;
  ctx: FormatContext;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Changes each time the link editor should open (Ctrl/⌘ + K). */
  linkRequest: number;
  /** Packages a command needed but couldn't add because the open file has no preamble. */
  missing: Package[];
  onDismissMissing: () => void;
}

interface ToolBase {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  /** Shown on the right of the tool's row in the More menu. */
  detail?: string;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
}
interface ButtonTool extends ToolBase {
  run: (view: EditorView) => unknown;
}
interface PanelTool extends ToolBase {
  panel: (view: EditorView, close: () => void) => ReactNode;
}
type Tool = ButtonTool | PanelTool;
interface ToolGroup {
  id: string;
  tools: Tool[];
}

const isPanel = (tool: Tool): tool is PanelTool => 'panel' in tool;

// Keep the editor's focus and selection when a toolbar button is pressed.
const keepFocus = (e: MouseEvent) => e.preventDefault();

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const keyLabel = (spec: string) =>
  spec
    .split('-')
    .map((k) => (k === 'Mod' ? (MAC ? '⌘' : 'Ctrl') : k === 'Shift' ? (MAC ? '⇧' : 'Shift') : k.toUpperCase()))
    .join(MAC ? '' : '+');
const titleFor = (tool: ToolBase) => (tool.shortcut ? `${tool.label} (${keyLabel(tool.shortcut)})` : tool.label);

/** Room for the More button and its separator. */
const MORE_WIDTH = 40;

const SIZE_LABELS: Record<string, [label: string, scale: number]> = {
  tiny: ['Tiny', 0.6],
  scriptsize: ['Script', 0.7],
  footnotesize: ['Footnote', 0.8],
  small: ['Small', 0.9],
  normalsize: ['Normal', 1],
  large: ['Large', 1.12],
  Large: ['Larger', 1.25],
  LARGE: ['Largest', 1.4],
  huge: ['Huge', 1.55],
  Huge: ['Huger', 1.7],
};

export default function EditorToolbar({
  getView,
  ctx,
  canUndo,
  canRedo,
  zoom,
  onZoom,
  linkRequest,
  missing,
  onDismissMissing,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(Infinity);
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);

  const closePopover = useCallback(() => setOpenId(null), []);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPanel(null);
  }, []);

  const run = (command: (view: EditorView) => unknown) => {
    const view = getView();
    if (!view) return;
    command(view);
    view.focus();
  };

  const has = (cmd: string) => !!findGroup(ctx, [cmd]);
  const lists = ctx.envs.filter((e) => LISTS.includes(e.name));
  const list = lists[0]?.name;
  const align = findEnv(ctx, ALIGNMENTS)?.name ?? 'flushleft';
  const textColor = findGroup(ctx, ['textcolor'])?.arg;
  const highlight = findGroup(ctx, ['colorbox'])?.arg;
  const size = findGroup(ctx, SIZES)?.cmd;
  const headingLabel = HEADINGS.find((h) => h.cmd === ctx.heading)?.label ?? 'Normal text';

  const icon = (name: IconName) => <Icon name={name} />;
  const swatchIcon = (name: IconName, swatches: Swatch[], current?: string) => (
    <span className="swatch-icon">
      <Icon name={name} />
      <span
        className="swatch-bar"
        style={{ background: current ? (swatches.find((s) => s.name === current)?.css ?? 'currentColor') : undefined }}
      />
    </span>
  );
  const toggle = (
    id: string,
    label: string,
    name: IconName,
    cmd: string,
    shortcut?: string,
    packages: Package[] = [],
    exclusive: string[] = [],
  ): ButtonTool => ({
    id,
    label,
    icon: icon(name),
    shortcut,
    active: has(cmd),
    run: (v) => toggleCommand(v, cmd, packages, exclusive),
  });

  const groups: ToolGroup[] = [
    {
      id: 'history',
      tools: [
        { id: 'undo', label: 'Undo', icon: icon('undo'), shortcut: 'Mod-z', disabled: !canUndo, run: (v) => undo(v) },
        { id: 'redo', label: 'Redo', icon: icon('redo'), shortcut: 'Mod-Shift-z', disabled: !canRedo, run: (v) => redo(v) },
      ],
    },
    {
      id: 'style',
      tools: [
        {
          id: 'heading',
          label: 'Heading',
          detail: headingLabel,
          wide: true,
          icon: (
            <span className="tool-text">
              {headingLabel}
              <Icon name="caret" size={12} />
            </span>
          ),
          panel: (view, close) => (
            <MenuList
              current={ctx.heading ?? ''}
              options={[{ value: '', label: 'Normal text' }, ...HEADINGS.map((h) => ({ value: h.cmd, label: h.label }))]}
              optionClass={(value) => `heading-option heading-${value || 'normal'}`}
              onPick={(cmd) => {
                heading(view, cmd);
                close();
              }}
            />
          ),
        },
        {
          id: 'size',
          label: 'Text size',
          icon: icon('size'),
          detail: size ? SIZE_LABELS[size][0] : undefined,
          active: !!size,
          panel: (view, close) => (
            <MenuList
              current={size ?? ''}
              options={[
                { value: '', label: 'Default' },
                ...SIZES.map((s) => ({
                  value: s,
                  label: SIZE_LABELS[s][0],
                  hint: `\\${s}`,
                  style: { fontSize: `${SIZE_LABELS[s][1]}em` },
                })),
              ]}
              onPick={(s) => {
                setSize(view, s || null);
                close();
              }}
            />
          ),
        },
      ],
    },
    {
      id: 'text',
      tools: [
        toggle('bold', 'Bold', 'bold', 'textbf', 'Mod-b'),
        toggle('italic', 'Italic', 'italic', 'textit', 'Mod-i'),
        toggle('underline', 'Underline', 'underline', 'underline', 'Mod-u'),
        toggle('strike', 'Strikethrough', 'strike', 'sout', 'Mod-Shift-x', ['ulem']),
        toggle('sub', 'Subscript', 'subscript', 'textsubscript', 'Mod-,', [], SCRIPTS),
        toggle('sup', 'Superscript', 'superscript', 'textsuperscript', 'Mod-.', [], SCRIPTS),
        toggle('mono', 'Monospace', 'code', 'texttt'),
        {
          id: 'color',
          label: 'Text color',
          detail: textColor,
          icon: swatchIcon('textColor', TEXT_COLORS, textColor),
          active: !!textColor,
          panel: (view, close) => (
            <ColorPanel
              swatches={TEXT_COLORS}
              current={textColor}
              noneLabel="Default color"
              onPick={(c) => {
                setColor(view, 'textcolor', c);
                close();
              }}
            />
          ),
        },
        {
          id: 'highlight',
          label: 'Highlight',
          detail: highlight,
          icon: swatchIcon('highlight', HIGHLIGHT_COLORS, highlight),
          active: !!highlight,
          panel: (view, close) => (
            <ColorPanel
              swatches={HIGHLIGHT_COLORS}
              current={highlight}
              noneLabel="No highlight"
              onPick={(c) => {
                setColor(view, 'colorbox', c);
                close();
              }}
            />
          ),
        },
        { id: 'clear', label: 'Clear formatting', icon: icon('clear'), run: clearFormatting },
      ],
    },
    {
      id: 'align',
      tools: [
        {
          id: 'alignLeft',
          label: 'Align left',
          icon: icon('alignLeft'),
          active: align === 'flushleft',
          run: (v) => setAlignment(v, 'flushleft'),
        },
        {
          id: 'alignCenter',
          label: 'Center',
          icon: icon('alignCenter'),
          active: align === 'center',
          run: (v) => setAlignment(v, 'center'),
        },
        {
          id: 'alignRight',
          label: 'Align right',
          icon: icon('alignRight'),
          active: align === 'flushright',
          run: (v) => setAlignment(v, 'flushright'),
        },
      ],
    },
    {
      id: 'lists',
      tools: [
        {
          id: 'bullets',
          label: 'Bulleted list',
          icon: icon('bulletList'),
          shortcut: 'Mod-Shift-8',
          active: list === 'itemize',
          run: (v) => toggleList(v, 'itemize'),
        },
        {
          id: 'numbers',
          label: 'Numbered list',
          icon: icon('numberedList'),
          shortcut: 'Mod-Shift-7',
          active: list === 'enumerate',
          run: (v) => toggleList(v, 'enumerate'),
        },
        {
          id: 'description',
          label: 'Description list',
          icon: icon('descriptionList'),
          active: list === 'description',
          run: (v) => toggleList(v, 'description'),
        },
        {
          id: 'outdent',
          label: 'Outdent list item',
          icon: icon('outdent'),
          shortcut: 'Shift-Tab',
          disabled: lists.length < 2,
          run: outdentItems,
        },
        {
          id: 'indent',
          label: 'Indent list item',
          icon: icon('indent'),
          shortcut: 'Tab',
          disabled: !list,
          run: indentItems,
        },
      ],
    },
    {
      id: 'insert',
      tools: [
        {
          id: 'link',
          label: 'Link',
          icon: icon('link'),
          shortcut: 'Mod-k',
          active: has('href') || has('url'),
          panel: (view, close) => <LinkPanel view={view} close={close} />,
        },
        { id: 'footnote', label: 'Footnote', icon: icon('footnote'), run: (v) => wrap(v, '\\footnote{', '}') },
        { id: 'comment', label: 'Comment out lines', icon: icon('comment'), shortcut: 'Mod-/', run: (v) => toggleComment(v) },
      ],
    },
    {
      id: 'math',
      tools: [
        { id: 'inlineMath', label: 'Inline math', icon: icon('inlineMath'), run: (v) => wrap(v, '$', '$') },
        { id: 'displayMath', label: 'Display math', icon: icon('displayMath'), run: (v) => wrap(v, '\\[', '\\]') },
        {
          id: 'mathTemplates',
          label: 'Equations and math templates',
          icon: icon('fraction'),
          panel: (view, close) => (
            <MathPanel
              onPick={(t) => {
                insertMath(view, t);
                close();
              }}
            />
          ),
        },
        {
          id: 'symbols',
          label: 'Insert a math symbol',
          icon: icon('omega'),
          panel: (view, close) => (
            <SymbolPanel
              onPick={(tex) => {
                insertSymbol(view, tex);
                close();
              }}
            />
          ),
        },
      ],
    },
    {
      id: 'refs',
      tools: [
        {
          id: 'table',
          label: 'Table',
          icon: icon('table'),
          panel: (view, close) => (
            <TablePanel
              onPick={(rows, cols) => {
                insertTable(view, rows, cols);
                close();
              }}
            />
          ),
        },
        { id: 'label', label: 'Label (\\label)', icon: icon('label'), run: insertLabel },
        {
          id: 'ref',
          label: 'Cross-reference (\\ref)',
          icon: icon('ref'),
          panel: (view, close) => <RefPanel view={view} close={close} />,
        },
        { id: 'cite', label: 'Citation (\\cite)', icon: icon('cite'), run: (v) => insertRef(v, 'cite') },
      ],
    },
  ];

  // Groups that don't fit collapse, last first, into the More menu.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const widths = groupRefs.current.slice(0, groups.length).map((el) => el?.offsetWidth ?? 0);
      const style = getComputedStyle(root);
      const available =
        root.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        (endRef.current?.offsetWidth ?? 0) -
        12;
      if (widths.reduce((a, b) => a + b, 0) <= available) return setVisibleCount(groups.length);
      let used = MORE_WIDTH;
      let count = 0;
      while (count < widths.length && used + widths[count] <= available) used += widths[count++];
      setVisibleCount(count);
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    return () => observer.disconnect();
  }, [groups.length]);

  const visible = groups.slice(0, visibleCount);
  const hidden = groups.slice(visibleCount);

  useEffect(() => {
    if (!linkRequest) return;
    if (visible.some((g) => g.tools.some((t) => t.id === 'link'))) {
      setOpenId('link');
    } else {
      setMenuOpen(true);
      setMenuPanel('link');
    }
  }, [linkRequest]);

  const renderTool = (tool: Tool, measure = false) => {
    const className = `tool-btn${tool.active ? ' active' : ''}${tool.wide ? ' wide' : ''}`;
    const common = {
      className,
      title: titleFor(tool),
      'aria-label': tool.label,
      disabled: tool.disabled,
      onMouseDown: keepFocus,
      tabIndex: measure ? -1 : undefined,
    };
    if (!isPanel(tool)) {
      return (
        <button key={tool.id} {...common} aria-pressed={tool.active} onClick={() => run(tool.run)}>
          {tool.icon}
        </button>
      );
    }
    if (measure) {
      return (
        <button key={tool.id} {...common}>
          {tool.icon}
        </button>
      );
    }
    const open = openId === tool.id;
    const view = open ? getView() : null;
    return (
      <Popover
        key={tool.id}
        open={!!view}
        onClose={closePopover}
        label={tool.label}
        className={`panel-${tool.id}`}
        button={
          <button
            {...common}
            className={`${className}${open ? ' open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpenId(open ? null : tool.id)}
          >
            {tool.icon}
          </button>
        }
      >
        {view && tool.panel(view, closePopover)}
      </Popover>
    );
  };

  const menuTool = hidden.flatMap((g) => g.tools).find((t) => t.id === menuPanel);
  const menuView = menuOpen ? getView() : null;

  return (
    <>
      <div className="editor-toolbar" ref={rootRef} role="toolbar" aria-label="Formatting">
        {visible.map((g) => (
          <div className="tool-group" key={g.id}>
            {g.tools.map((t) => renderTool(t))}
          </div>
        ))}
        {hidden.length > 0 && (
          <div className="tool-group">
            <Popover
              open={menuOpen}
              onClose={closeMenu}
              label="More tools"
              className="tool-menu"
              button={
                <button
                  className={`tool-btn${menuOpen ? ' open' : ''}`}
                  title="More tools"
                  aria-label="More tools"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onMouseDown={keepFocus}
                  onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                >
                  <Icon name="more" />
                </button>
              }
            >
              {menuView && menuTool && isPanel(menuTool) ? (
                <>
                  <button className="menu-back" onMouseDown={keepFocus} onClick={() => setMenuPanel(null)}>
                    <Icon name="chevronLeft" size={14} />
                    {menuTool.label}
                  </button>
                  <div className={`panel-${menuTool.id}`}>{menuTool.panel(menuView, closeMenu)}</div>
                </>
              ) : (
                hidden.map((g) => (
                  <div className="menu-group" role="menu" key={g.id}>
                    {g.tools.map((t) => (
                      <button
                        key={t.id}
                        role="menuitem"
                        className={`menu-row${t.active ? ' active' : ''}`}
                        disabled={t.disabled}
                        onMouseDown={keepFocus}
                        onClick={() => {
                          if (isPanel(t)) return setMenuPanel(t.id);
                          run(t.run);
                          closeMenu();
                        }}
                      >
                        <span className="menu-icon">{t.id === 'heading' ? icon('heading') : t.icon}</span>
                        <span className="menu-label">{t.label}</span>
                        {t.detail && <span className="menu-hint">{t.detail}</span>}
                        {t.shortcut && <kbd>{keyLabel(t.shortcut)}</kbd>}
                        {isPanel(t) && <Icon name="chevronRight" size={14} />}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </Popover>
          </div>
        )}
        <div className="spacer" />
        <div className="tool-group zoom" ref={endRef}>
          <button className="tool-btn" onMouseDown={keepFocus} onClick={() => onZoom(zoom - 0.1)} title={`Smaller text (${keyLabel('Mod--')})`}>
            <Icon name="minus" />
          </button>
          <button className="tool-btn wide-auto" onMouseDown={keepFocus} onClick={() => onZoom(1)} title={`Reset text size (${keyLabel('Mod-0')})`}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool-btn" onMouseDown={keepFocus} onClick={() => onZoom(zoom + 0.1)} title={`Larger text (${keyLabel('Mod-=')})`}>
            <Icon name="plus" />
          </button>
        </div>
        {/* An invisible copy of every group, to measure how many fit. */}
        <div className="toolbar-measure" aria-hidden="true">
          {groups.map((g, i) => (
            <div
              className="tool-group"
              key={g.id}
              ref={(el) => {
                groupRefs.current[i] = el;
              }}
            >
              {g.tools.map((t) => renderTool(t, true))}
            </div>
          ))}
        </div>
      </div>
      {missing.length > 0 && (
        <div className="package-notice" role="status">
          <span>
            Add {missing.map((p) => <code key={p}>{packageLine(p)}</code>)} to your main file's preamble for this to compile.
          </span>
          <button className="tool-btn" title="Dismiss" aria-label="Dismiss" onClick={onDismissMissing}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}

interface Option {
  value: string;
  label: string;
  hint?: string;
  style?: CSSProperties;
}

function MenuList({
  options,
  current,
  onPick,
  optionClass,
}: {
  options: Option[];
  current: string;
  onPick: (value: string) => void;
  optionClass?: (value: string) => string;
}) {
  return (
    <div className="menu-list" role="menu">
      {options.map((o) => (
        <button
          key={o.value}
          role="menuitemradio"
          aria-checked={current === o.value}
          className={`menu-row ${optionClass?.(o.value) ?? ''}`}
          onMouseDown={keepFocus}
          onClick={() => onPick(o.value)}
        >
          <span className="menu-icon">{current === o.value && <Icon name="check" size={14} />}</span>
          <span className="menu-label" style={o.style}>
            {o.label}
          </span>
          {o.hint && <span className="menu-hint mono">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function ColorPanel({
  swatches,
  current,
  noneLabel,
  onPick,
}: {
  swatches: Swatch[];
  current?: string;
  noneLabel: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <div className="color-panel">
      <button className="menu-row" onMouseDown={keepFocus} onClick={() => onPick(null)}>
        <span className="menu-icon">{!current && <Icon name="check" size={14} />}</span>
        <span className="menu-label">{noneLabel}</span>
      </button>
      <div className="swatch-grid">
        {swatches.map((s) => (
          <button
            key={s.name}
            className={`swatch${current === s.name ? ' selected' : ''}`}
            style={{ background: s.css }}
            title={s.name}
            aria-label={s.name}
            onMouseDown={keepFocus}
            onClick={() => onPick(s.name)}
          />
        ))}
      </div>
    </div>
  );
}

const TABLE_MAX = 8;

function TablePanel({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  return (
    <div className="table-picker">
      <div className="table-grid" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
        {Array.from({ length: TABLE_MAX * TABLE_MAX }, (_, i) => {
          const rows = Math.floor(i / TABLE_MAX) + 1;
          const cols = (i % TABLE_MAX) + 1;
          return (
            <button
              key={i}
              className={`table-cell${rows <= hover.rows && cols <= hover.cols ? ' on' : ''}`}
              aria-label={`${rows} × ${cols} table`}
              onMouseEnter={() => setHover({ rows, cols })}
              onFocus={() => setHover({ rows, cols })}
              onMouseDown={keepFocus}
              onClick={() => onPick(rows, cols)}
            />
          );
        })}
      </div>
      <div className="table-size">{hover.rows ? `${hover.rows} × ${hover.cols}` : 'Rows × columns'}</div>
    </div>
  );
}

function MathPanel({ onPick }: { onPick: (t: MathTemplate) => void }) {
  return (
    <div className="menu-list" role="menu">
      {MATH_TEMPLATES.map((t) => (
        <button key={t.label} role="menuitem" className="menu-row" onMouseDown={keepFocus} onClick={() => onPick(t)}>
          <span className="math-preview">{t.preview}</span>
          <span className="menu-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function SymbolPanel({ onPick }: { onPick: (tex: string) => void }) {
  return (
    <div className="symbol-panel">
      {SYMBOL_GROUPS.map((g) => (
        <section key={g.name}>
          <h4>{g.name}</h4>
          <div className="symbol-grid">
            {g.symbols.map((s) => (
              <button key={s.tex} className="symbol" title={s.tex} onMouseDown={keepFocus} onClick={() => onPick(s.tex)}>
                {s.char}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LinkPanel({ view, close }: { view: EditorView; close: () => void }) {
  const initial = useMemo(() => linkAt(view.state), [view]);
  const [url, setUrl] = useState(initial.url);
  const [text, setText] = useState(initial.text);
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        setLink(view, url, text);
        close();
      }}
      onKeyDown={(e) => e.key === 'Escape' && view.focus()}
    >
      <label>
        Link to
        <input
          autoFocus={!initial.url}
          inputMode="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label>
        Text
        <input
          autoFocus={!!initial.url}
          placeholder="Leave empty to show the URL"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="panel-actions">
        {initial.existing && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              removeLink(view);
              close();
            }}
          >
            Remove link
          </button>
        )}
        <button type="submit" className="btn small primary" disabled={!url.trim()}>
          {initial.existing ? 'Update' : 'Insert'}
        </button>
      </div>
    </form>
  );
}

const REF_KINDS = [
  { cmd: 'ref', label: 'Number' },
  { cmd: 'eqref', label: 'Equation' },
  { cmd: 'pageref', label: 'Page' },
] as const;

function RefPanel({ view, close }: { view: EditorView; close: () => void }) {
  const labels = useMemo(() => labelsIn(view.state.doc.toString()), [view]);
  const [cmd, setCmd] = useState<(typeof REF_KINDS)[number]['cmd']>('ref');
  const [filter, setFilter] = useState('');
  const shown = labels.filter((l) => l.toLowerCase().includes(filter.toLowerCase()));
  const pick = (key: string) => {
    insertRef(view, cmd, key);
    close();
  };
  return (
    <div className="form-panel" onKeyDown={(e) => e.key === 'Escape' && view.focus()}>
      <div className="segmented" role="radiogroup" aria-label="Reference to">
        {REF_KINDS.map((k) => (
          <button key={k.cmd} role="radio" aria-checked={cmd === k.cmd} className={cmd === k.cmd ? 'on' : ''} onClick={() => setCmd(k.cmd)}>
            {k.label}
          </button>
        ))}
      </div>
      <input
        autoFocus
        placeholder="Filter labels"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown[0]) {
            e.preventDefault();
            pick(shown[0]);
          }
        }}
      />
      <div className="ref-list">
        {shown.length ? (
          shown.map((l) => (
            <button key={l} className="menu-row" onClick={() => pick(l)}>
              <code>{l}</code>
            </button>
          ))
        ) : (
          <p className="muted small">{labels.length ? 'No matching labels.' : 'No \\label{…} in this file yet.'}</p>
        )}
      </div>
    </div>
  );
}
