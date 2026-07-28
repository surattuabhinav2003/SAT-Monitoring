import { Link } from 'react-router-dom';
import './NotFound.css';

/**
 * 404 fallback route.
 */
export default function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-code">404</div>
      <h1>Page not found</h1>
      <p>The page you are looking for doesn&apos;t exist or has been moved.</p>
      <Link to="/dashboard" className="btn btn--primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
