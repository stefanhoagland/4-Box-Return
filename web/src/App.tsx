import { Admin } from './Admin';
import { Viewer } from './Viewer';

export function App() {
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
  return isAdmin ? <Admin /> : <Viewer />;
}
