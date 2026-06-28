#!/usr/bin/env python3
"""Build-time precomputation engine for the recommendation model.

Runs density-based HDBSCAN clustering, resolves outliers, calculates
Bayesian average quality weights, and isolates the Top-50 semantic
neighbors for each movie.
"""

import os
import sys
import numpy as np
from sklearn.cluster import HDBSCAN

import catalog_io
import recommendation_pb2


def load_all_embeddings(embeddings_path: str, num_movies: int, dim: int) -> np.ndarray:
    """Read previously computed vectors from embeddings.bin or embeddings_part*.bin files."""
    blob = bytearray()
    if os.path.exists(embeddings_path):
        with open(embeddings_path, "rb") as f:
            blob.extend(f.read())
    else:
        # Check for chunked parts in the same directory
        dir_name = os.path.dirname(embeddings_path) or "."
        part_idx = 0
        while True:
            part_path = os.path.join(dir_name, f"embeddings_part{part_idx}.bin")
            if not os.path.exists(part_path):
                break
            with open(part_path, "rb") as f:
                blob.extend(f.read())
            part_idx += 1

    if not blob:
        print("Warning: No embeddings found. Returning zero matrix.")
        return np.zeros((num_movies, dim), dtype=np.float32)

    bytes_per_vector = dim * 4
    X = np.frombuffer(blob, dtype=np.float32)
    
    # Reshape and handle size mismatch
    num_vectors = len(X) // dim
    X = X[:num_vectors * dim].reshape(num_vectors, dim)
    
    if num_vectors < num_movies:
        print(f"Warning: Embeddings count ({num_vectors}) is less than movie catalog size ({num_movies}). Padding with zeros.")
        padded = np.zeros((num_movies, dim), dtype=np.float32)
        padded[:num_vectors] = X
        return padded
    elif num_vectors > num_movies:
        return X[:num_movies]
        
    return X


def precompute_recommendation_data(movies_path: str, embeddings_path: str, output_path: str, min_cluster_size: int = 10, dim: int = 3072) -> None:
    print(f"Starting precomputation: movies={movies_path}, embeddings={embeddings_path}, output={output_path}")

    # 1. Load movies catalog proto
    catalog = catalog_io.load_catalog_proto(movies_path)
    movies = catalog.movies
    num_movies = len(movies)
    if num_movies == 0:
        print("Empty catalog. Skipping precomputation.")
        return

    print(f"Loaded {num_movies} movies.")

    # 2. Load embeddings
    X = load_all_embeddings(embeddings_path, num_movies, dim)
    print(f"Loaded embeddings matrix of shape {X.shape}.")

    # 3. L2-Normalize row vectors
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X_norm = X / norms

    # 4. Compute Cosine Distance Matrix
    print("Computing cosine similarity and distance matrices...")
    sim_matrix = np.dot(X_norm, X_norm.T)
    # Raise to power of 4 to expand similarity contrast and resolve distance concentration in 3072-D
    sim_matrix_scaled = np.power(np.maximum(sim_matrix, 0.0), 4)
    dist_matrix = np.clip(1.0 - sim_matrix_scaled, 0.0, 2.0)

    # 5. Run HDBSCAN
    print(f"Running HDBSCAN clustering (min_cluster_size={min_cluster_size}, min_samples=9, leaf)...")
    hdb = HDBSCAN(min_cluster_size=min_cluster_size, metric='precomputed', min_samples=9, cluster_selection_method='leaf')
    labels = hdb.fit_predict(dist_matrix.astype(np.float64))

    # 6. Resolve noise / outliers (-1)
    unique_labels = np.unique(labels)
    valid_clusters = [c for c in unique_labels if c != -1]
    print(f"Discovered {len(valid_clusters)} valid clusters.")

    if len(valid_clusters) > 0:
        print("Re-assigning outliers to nearest clusters...")
        cluster_means = []
        for c in valid_clusters:
            member_indices = np.where(labels == c)[0]
            mean_sim = sim_matrix[:, member_indices].mean(axis=1)
            cluster_means.append(mean_sim)
        cluster_means = np.column_stack(cluster_means)  # shape (num_movies, num_valid_clusters)

        best_cluster_indices = np.argmax(cluster_means, axis=1)
        resolved_labels = np.array([valid_clusters[idx] for idx in best_cluster_indices])

        noise_mask = (labels == -1)
        num_noise = np.sum(noise_mask)
        labels[noise_mask] = resolved_labels[noise_mask]
        print(f"Reassigned {num_noise} outlier movies to nearest clusters.")
    else:
        labels = np.zeros(num_movies, dtype=np.int32)
        print("No valid clusters discovered. All assigned to cluster 0.")

    # 7. Calculate Bayesian average quality weights [0, 1]
    print("Pre-calculating Bayesian average quality weights...")
    vote_counts = np.array([float(m.vote_count) for m in movies])
    vote_averages = np.array([float(m.vote_average) for m in movies])
    
    # R is raw rating normalized out of 10.0 to range [0, 1]
    R = vote_averages / 10.0
    C = np.mean(R) if num_movies > 0 else 0.5
    
    m_threshold = 500.0
    bayesian_rating = (vote_counts / (vote_counts + m_threshold)) * R + (m_threshold / (vote_counts + m_threshold)) * C
    
    # Read and normalize popularity (log-scaled)
    popularity = np.array([float(m.popularity) for m in movies])
    log_pop = np.log1p(popularity)
    max_log_pop = np.max(log_pop) if len(log_pop) > 0 else 1.0
    norm_pop = log_pop / max_log_pop if max_log_pop > 0 else log_pop
    
    # Blend 70% Bayesian Average Quality + 30% Normalized Popularity
    critical_scores = 0.70 * bayesian_rating + 0.30 * norm_pop

    # 8. Identify Top 50 nearest neighbors and populate MovieManifest proto
    print("Isolating Top-50 nearest semantic neighbors for each movie...")
    movie_ids = [str(m.id) for m in movies]
    manifest_msg = recommendation_pb2.MovieManifest()

    # Pre-clamp similarities to [0, 1] for storage in manifest
    sim_matrix_clamped = np.clip(sim_matrix, 0.0, 1.0)

    for i, movie in enumerate(movies):
        sims = sim_matrix_clamped[i].copy()
        sims[i] = -1.0  # exclude self
        
        top_indices = np.argsort(sims)[::-1][:50]

        pb_movie = recommendation_pb2.Movie()
        pb_movie.title = movie.title
        pb_movie.cluster_id = int(labels[i])
        
        # Take primary director
        pb_movie.director = movie.director[0] if (movie.director and len(movie.director) > 0) else ""
        
        # Genres mapping
        for g_enum in movie.genres:
            g_name = catalog_io.ENUM_TO_GENRE_NAME.get(g_enum)
            if g_name:
                pb_movie.genres.append(g_name)

        pb_movie.critical_score = float(critical_scores[i])

        # Neighbors
        for idx in top_indices:
            score = sims[idx]
            if score >= 0.0:
                pb_movie.top_neighbors[movie_ids[idx]] = float(score)

        manifest_msg.movies[movie_ids[i]].CopyFrom(pb_movie)

    # Save manifest atomically
    tmp_path = output_path + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(manifest_msg.SerializeToString())
    os.replace(tmp_path, output_path)
    print(f"Precomputation finished. Manifest saved: {output_path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Precomputation script")
    parser.add_argument("--movies", default="public/data/movies.pbf", help="Path to movies.pbf catalog")
    parser.add_argument("--embeddings", default="public/data/embeddings.bin", help="Path to embeddings.bin")
    parser.add_argument("--output", default="public/data/movie_manifest.pb", help="Path to write recommendation manifest")
    parser.add_argument("--dim", type=int, default=3072, help="Embedding dimensionality")
    parser.add_argument("--min-cluster-size", type=int, default=10, help="HDBSCAN min cluster size")
    args = parser.parse_args()
    
    precompute_recommendation_data(
        movies_path=args.movies,
        embeddings_path=args.embeddings,
        output_path=args.output,
        min_cluster_size=args.min_cluster_size,
        dim=args.dim
    )
