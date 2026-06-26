import { KMeans } from 'ml-kmeans';
const data = [[1, 2], [1, 4], [1, 0], [10, 2], [10, 4], [10, 0]];
const ans = new KMeans({ k: 2 }).cluster(data);
console.log(ans);
