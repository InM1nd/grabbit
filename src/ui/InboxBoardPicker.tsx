import React from 'react';
import type { Board, Post } from '../db';
import { t } from '../i18n';
import { ActionSheet } from './common';

export function InboxBoardPicker({ post, boards, onClose, onPick, onCreate }: {
  post: Post | null;
  boards: Board[];
  onClose: () => void;
  onCreate?: (post: Post) => void;
  onPick: (post: Post, board: Board) => void;
}) {
  return <ActionSheet visible={post != null} title={t('Выбрать доску')} onClose={onClose}
    actions={post ? [...boards.map((board) => ({
      label: [board.emoji, board.name].filter(Boolean).join(' '),
      icon: 'folder-outline',
      onPress: () => onPick(post, board),
    })), ...(onCreate ? [{ label: t('Новая доска'), icon: 'add-outline', onPress: () => onCreate(post) }] : [])] : []} />;
}
