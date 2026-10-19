import { useHash } from './hooks';
import EditorPage from './pages/EditorPage';
import ProjectList from './pages/ProjectList';

export default function App() {
  const hash = useHash();
  const match = /^#\/p\/([^/]+)/.exec(hash);
  if (match) {
    const id = decodeURIComponent(match[1]);
    return <EditorPage key={id} projectId={id} />;
  }
  return <ProjectList />;
}
