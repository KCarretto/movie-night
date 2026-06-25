import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import Vote from './Vote.jsx';

// Mock dependencies
vi.mock('../state/controller.js', () => ({
  actions: {
    vote: vi.fn(),
    closeVoting: vi.fn(),
  },
}));

vi.mock('../lib/catalog.js', () => ({
  movieMeta: vi.fn(() => ({ id: 1, title: 'Mock Movie', genres: [], release_date: '2023-01-01' })),
}));

let mockState = {};
vi.mock('../state/useStore.js', () => ({
  useStore: () => mockState,
}));

let dndContextProps = null;
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DndContext: (props) => {
      dndContextProps = props; // Capture props so we can call onDragEnd
      return <div data-testid="dnd-context">{props.children}</div>;
    },
    DragOverlay: ({ children }) => <div>{children}</div>,
  };
});

describe('Vote component', () => {
  test('drag and drop reordering works and survives irrelevant state updates', () => {
    mockState = {
      isHost: true,
      myId: 'peer1',
      state: {
        peers: [{ id: 'peer1', name: 'Host' }],
        movies: [{ id: 'm1', title: 'Movie 1', tmdbId: 1 }, { id: 'm2', title: 'Movie 2', tmdbId: 2 }],
        votes: {},
      }
    };

    const { rerender } = render(<Vote />);

    let items = screen.getAllByText(/Movie [12]/);
    expect(items[0].textContent).toBe('Movie 1');
    expect(items[1].textContent).toBe('Movie 2');

    act(() => {
      dndContextProps.onDragStart({ active: { id: 'm1' } });
      dndContextProps.onDragEnd({
        active: { id: 'm1' },
        over: { id: 'm2' }
      });
    });

    items = screen.getAllByText(/Movie [12]/);
    expect(items[0].textContent).toBe('Movie 2');
    expect(items[1].textContent).toBe('Movie 1');

    mockState = {
      ...mockState,
      state: {
        ...mockState.state,
        movies: [{ id: 'm1', title: 'Movie 1', tmdbId: 1 }, { id: 'm2', title: 'Movie 2', tmdbId: 2 }],
      }
    };

    rerender(<Vote />);

    items = screen.getAllByText(/Movie [12]/);
    expect(items[0].textContent).toBe('Movie 2');
    expect(items[1].textContent).toBe('Movie 1');
  });
});
