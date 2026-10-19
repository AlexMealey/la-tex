import { useState, type FormEvent } from 'react';
import { api, type ProjectMeta, type TemplateId } from '../api';
import Modal from './Modal';

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'blank-a4', label: 'Blank (A4)', description: 'A minimal article on A4 paper.' },
  {
    id: 'resume-a4',
    label: 'Resume (A4)',
    description: 'Resume preamble with Font Awesome 5, Fira Mono, TeX Gyre Heros and custom underlines.',
  },
];

interface Props {
  onClose: () => void;
  onCreated: (project: ProjectMeta) => void;
}

export default function NewProjectDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TemplateId>('resume-a4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createProject(name.trim() || 'Untitled', template));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field-block">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My CV" />
        </label>
        <fieldset className="template-list">
          <legend>Template</legend>
          {TEMPLATES.map((t) => (
            <label key={t.id} className={`template-option${template === t.id ? ' selected' : ''}`}>
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
              />
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error && <div className="banner error">{error}</div>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
