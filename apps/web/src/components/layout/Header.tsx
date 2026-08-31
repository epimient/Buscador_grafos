import { Link, NavLink } from 'react-router-dom';
import { BarChart3, ImageIcon, Tag, Network } from 'lucide-react';
import { SearchBar } from '@/components/features/SearchBar';
import { cn } from '@/lib/utils';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
    isActive ? 'bg-white/10 text-ink' : 'text-ink-dim hover:bg-white/5 hover:text-ink',
  );

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-6 px-4 py-3 md:px-6">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-tight text-ink"
        >
          <span className="hidden sm:inline">Vorael</span>
        </Link>

        <div className="flex-1">
          <SearchBar />
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink to="/" end className={navLinkClass}>
            <ImageIcon className="h-4 w-4" />
            Galería
          </NavLink>
          <NavLink to="/tags" className={navLinkClass}>
            <Tag className="h-4 w-4" />
            Tags
          </NavLink>
          <NavLink to="/stats" className={navLinkClass}>
            <BarChart3 className="h-4 w-4" />
            Stats
          </NavLink>
          <NavLink to="/graph" className={navLinkClass}>
            <Network className="h-4 w-4" />
            Red
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
