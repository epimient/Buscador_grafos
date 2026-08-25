import { Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { GalleryPage } from '@/pages/Gallery';
import { SearchPage } from '@/pages/Search';
import { ImageDetailPage } from '@/pages/ImageDetail';
import { TagPage } from '@/pages/TagPage';
import { TagsPage } from '@/pages/Tags';
import { StatsPage } from '@/pages/Stats';
import { NotFoundPage } from '@/pages/NotFound';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<GalleryPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="image/:id" element={<ImageDetailPage />} />
        <Route path="tag/:tag" element={<TagPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
