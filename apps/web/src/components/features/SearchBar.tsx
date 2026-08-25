import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';

interface Props {
  initialValue?: string;
  navigateOnChange?: boolean;
  onChange?: (q: string) => void;
}

export function SearchBar({ initialValue = '', navigateOnChange = true, onChange }: Props) {
  const [value, setValue] = useState(initialValue);
  const debounced = useDebounce(value, 300);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastNavigated = useRef(initialValue);

  useEffect(() => {
    setValue(initialValue);
    lastNavigated.current = initialValue;
  }, [initialValue]);

  useEffect(() => {
    onChange?.(debounced);
    if (!navigateOnChange) return;
    if (debounced === lastNavigated.current) return;
    lastNavigated.current = debounced;
    if (debounced.trim().length === 0) {
      navigate('/');
    } else {
      navigate(`/search?q=${encodeURIComponent(debounced.trim())}`);
    }
  }, [debounced, navigateOnChange, navigate, onChange]);

  return (
    <div className="group relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint group-focus-within:text-accent" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar por sujeto, prompt o tag…"
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-10 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition focus:border-accent/60 focus:bg-white/[0.05] focus:shadow-glow"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar"
          onClick={() => setValue('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint transition hover:bg-white/10 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
