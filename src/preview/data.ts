import type { Board, Post } from '../db';

const photo = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=85`;
const samples: Partial<Post>[] = [
  { title: 'Маленькая квартира, большие идеи', platform: 'instagram', boardId: 1, image: photo('photo-1600210492486-724fe5c67fb0'), tags: ['интерьер', 'дом'], mark: 'try', summary: 'Светлая гостиная с растениями и тёплым деревом. Идеи для небольшого пространства: лёгкая мебель, открытые полки и несколько источников света.' },
  { title: 'Паста, ради которой стоит остаться дома', platform: 'instagram', boardId: 2, image: photo('photo-1473093295043-cdd812d0e601'), tags: ['рецепт', 'ужин'], summary: 'Паста с зелёным песто, свежими томатами и базиликом. Простая идея для ужина, которую стоит попробовать на выходных.' },
  { title: 'Выходные без плана — в горах', platform: 'youtube', boardId: 3, image: photo('photo-1464822759023-fed622ff2c3b'), tags: ['горы', 'путешествия'], mark: 'done' },
  { title: 'Хороший интерфейс начинается с деталей', platform: 'web', boardId: 4, tags: ['дизайн', 'интерфейс'], summary: 'Заметки о типографике, ритме и маленьких взаимодействиях, которые делают приложение приятным.' },
  { title: 'Кофейни, в которые хочется вернуться', platform: 'instagram', boardId: 3, image: photo('photo-1442512595331-e89e73853f31'), tags: ['кофе', 'город'] },
  { title: 'Свет, растения и любимый уголок', platform: 'instagram', boardId: 1, image: photo('photo-1416879595882-3373a0480b5b'), tags: ['растения', 'дом'] },
  { title: 'Тот самый хрустящий завтрак', platform: 'youtube', boardId: 2, image: photo('photo-1525351484163-7529414344d8'), tags: ['завтрак', 'рецепт'], mark: 'try' },
  { title: 'Коллекция полезных инструментов для дизайнера', platform: 'github', boardId: 4, tags: ['дизайн', 'инструменты'], mark: 'skip' },
];

export const previewPosts: Post[] = samples.map((sample, i) => ({
  id: i + 1, url: `https://example.com/preview/${i + 1}`, rawText: null, platform: 'web', title: null,
  description: null, author: '@grabbit.demo', image: null, localImage: null, metaFetched: true,
  metaBlocked: false, unavailable: false, note: null, aiTitle: null,
  summary: 'Сохранено на потом. Идея, к которой приятно вернуться.', tags: [], boardId: null,
  status: 'done', attempts: 0, nextTryAt: 0, lastError: null, createdAt: 1793260800000,
  openedAt: i % 3 === 0 ? null : 1793260800000, remindedAt: null, mark: null, embedding: null,
  ...sample,
}));

export const previewBoards: Board[] = ['Для дома', 'Готовить', 'Места', 'Дизайн'].map((name, i) => ({
  id: i + 1, name, emoji: ['🪴', '🍝', '⛰️', '✳️'][i], createdAt: 1793260800000,
  count: previewPosts.filter(p => p.boardId === i + 1).length, covers: [],
}));
