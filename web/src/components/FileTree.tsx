import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { FileEntry } from '../api';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const ensureDir = (p: string): TreeNode => {
    const existing = dirs.get(p);
    if (existing) return existing;
    const node: TreeNode = { name: p.slice(p.lastIndexOf('/') + 1), path: p, type: 'dir', children: [] };
    ensureDir(parentOf(p)).children.push(node);
    dirs.set(p, node);
    return node;
  };
  for (const f of files) {
    if (f.type === 'dir') ensureDir(f.path);
    else ensureDir(parentOf(f.path)).children.push({ name: f.path.slice(f.path.lastIndexOf('/') + 1), path: f.path, type: 'file', children: [] });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

interface Props {
  files: FileEntry[];
  activePath: string | null;
  mainFile: string;
  onOpen: (path: string) => void;
  onCreateFile: (folder: string) => void;
  onCreateFolder: (folder: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onSetMain: (path: string) => void;
  onUpload: (folder: string, files: File[]) => void;
}

export default function FileTree(props: Props) {
  const { files, activePath, mainFile } = props;
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // New files go into the selected folder, or the folder of the open file.
  const currentFolder =
    selectedFolder || (activePath?.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : '');

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation();
      setDropTarget(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) props.onUpload(folder, dropped);
    },
  });

  const renderNode = (node: TreeNode, depth: number) => {
    const isDir = node.type === 'dir';
    const open = isDir && !collapsed.has(node.path);
    const classes = ['tree-row'];
    if (node.path === activePath) classes.push('active');
    if (isDir && node.path === selectedFolder) classes.push('selected');
    if (isDir && dropTarget === node.path) classes.push('drop');
    return (
      <li key={node.path}>
        <div
          className={classes.join(' ')}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            if (isDir) {
              toggle(node.path);
              setSelectedFolder(node.path);
            } else {
              setSelectedFolder('');
              props.onOpen(node.path);
            }
          }}
          title={node.path}
          {...(isDir ? dropProps(node.path) : {})}
        >
          <span className="tree-icon">{isDir ? (open ? '▾' : '▸') : ''}</span>
          <span className="tree-name">
            {node.name}
            {node.path === mainFile && (
              <span className="main-star" title="Main file">
                {' '}
                ★
              </span>
            )}
          </span>
          <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
            {!isDir && node.name.endsWith('.tex') && node.path !== mainFile && (
              <button title="Set as main file" onClick={() => props.onSetMain(node.path)}>
                ★
              </button>
            )}
            <button title="Rename / move" onClick={() => props.onRename(node.path)}>
              ✎
            </button>
            <button title="Delete" onClick={() => props.onDelete(node.path)}>
              ✕
            </button>
          </span>
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="file-tree" {...dropProps('')}>
      <div className="file-tree-header">
        <span>Files</span>
        <div className="row">
          <button className="btn small ghost" title="New file" onClick={() => props.onCreateFile(currentFolder)}>
            + File
          </button>
          <button className="btn small ghost" title="New folder" onClick={() => props.onCreateFolder(currentFolder)}>
            + Folder
          </button>
          <button className="btn small ghost" title="Upload files" onClick={() => uploadRef.current?.click()}>
            Upload
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length) props.onUpload(currentFolder, picked);
            }}
          />
        </div>
      </div>
      {currentFolder && (
        <div className="muted small tree-target">
          Adding to <code>{currentFolder}/</code>{' '}
          <button className="link" onClick={() => setSelectedFolder('')}>
            use root
          </button>
        </div>
      )}
      <ul className={`tree${dropTarget === '' ? ' drop' : ''}`}>{tree.map((n) => renderNode(n, 0))}</ul>
      <p className="muted small tree-hint">Drop files here to upload them.</p>
    </div>
  );
}
