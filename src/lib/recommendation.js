import protobuf from 'protobufjs/light';
import { cachedFetch } from './datacache.js';
import { runtime, emit } from './runtime.js';

// protobuf.js reflection descriptor for recommendation.proto.
const RECOMMENDATION_PROTO = {
  nested: {
    movienight: {
      nested: {
        MovieManifest: {
          fields: {
            movies: {
              keyType: 'string',
              type: 'Movie',
              id: 1
            }
          }
        },
        Movie: {
          fields: {
            title: { type: 'string', id: 1 },
            clusterId: { type: 'int32', id: 2 },
            director: { type: 'string', id: 3 },
            genres: { rule: 'repeated', type: 'string', id: 4 },
            criticalScore: { type: 'float', id: 5 },
            topNeighbors: {
              keyType: 'string',
              type: 'float',
              id: 6
            }
          }
        },
        UserNetworkProfile: {
          fields: {
            userId: { type: 'string', id: 1 },
            likedMovieIds: { rule: 'repeated', type: 'string', id: 2 },
            watchlistMovieIds: { rule: 'repeated', type: 'string', id: 3 },
            dislikeMovieIds: { rule: 'repeated', type: 'string', id: 4 },
            dislikeGenres: { rule: 'repeated', type: 'string', id: 5 },
            dislikeDirectors: { rule: 'repeated', type: 'string', id: 6 },
            genreWeights: { rule: 'repeated', type: 'GenreWeight', id: 7 },
            preferredDirectors: { rule: 'repeated', type: 'string', id: 8 },
            preferredActors: { rule: 'repeated', type: 'string', id: 9 }
          },
          nested: {
            GenreWeight: {
              fields: {
                genre: { type: 'string', id: 1 },
                weight: { type: 'int32', id: 2 }
              }
            }
          }
        },
        RoomSyncSession: {
          fields: {
            sessionId: { type: 'string', id: 1 },
            activeMembers: { rule: 'repeated', type: 'UserNetworkProfile', id: 2 }
          }
        }
      }
    }
  }
};

const root = protobuf.Root.fromJSON(RECOMMENDATION_PROTO);
const MovieManifestType = root.lookupType('movienight.MovieManifest');
const UserNetworkProfileType = root.lookupType('movienight.UserNetworkProfile');
const RoomSyncSessionType = root.lookupType('movienight.RoomSyncSession');

export const MovieManifest = {
  deserialize(buffer) {
    return MovieManifestType.decode(buffer);
  }
};

export const UserNetworkProfile = {
  serialize(profile) {
    const err = UserNetworkProfileType.verify(profile);
    if (err) throw new Error(err);
    const message = UserNetworkProfileType.create(profile);
    return UserNetworkProfileType.encode(message).finish();
  },
  deserialize(buffer) {
    return UserNetworkProfileType.decode(buffer);
  }
};

export const RoomSyncSession = {
  serialize(session) {
    const err = RoomSyncSessionType.verify(session);
    if (err) throw new Error(err);
    const message = RoomSyncSessionType.create(session);
    return RoomSyncSessionType.encode(message).finish();
  },
  deserialize(buffer) {
    return RoomSyncSessionType.decode(buffer);
  }
};

// Fetch and load the recommendation precomputed manifest
export async function loadRecommendationManifest() {
  runtime.recommendationStatus = 'loading';
  runtime.recommendationError = '';
  try {
    const res = await cachedFetch('data/movie_manifest.pb');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    runtime.recommendationManifest = MovieManifest.deserialize(new Uint8Array(buf));
    runtime.recommendationStatus = 'ready';
  } catch (e) {
    runtime.recommendationManifest = null;
    runtime.recommendationStatus = 'error';
    runtime.recommendationError = e.message || 'unknown error';
    console.warn('Could not load movie_manifest.pb:', e);
  }
  emit();
}
