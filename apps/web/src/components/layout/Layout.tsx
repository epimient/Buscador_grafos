import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Header } from './Header';
import { Footer } from './Footer';

export function Layout() {
  const location = useLocation();
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 md:px-6 md:py-8">
        {/* Keyed motion.div restarts the enter animation on each route change.
            We deliberately do NOT use AnimatePresence mode="wait" here because
            it stalls the swap with a shared <Outlet />, leaving the page blank. */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </main>
      <Footer />
    </div>
  );
}
