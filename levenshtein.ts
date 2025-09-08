/// Return the levenshtein distance between two strings.
/// The lower, the closest / more similar those strings are.
///
/// see <https://en.wikipedia.org/wiki/Levenshtein_distance>
export function levenshteinDistance(lhs: string, rhs: string) {
  const matrix = Array.from(
    {
      length: lhs.length + 1,
    },
    () => Array(rhs.length + 1).fill(0),
  );
  for (let i = 0; i <= lhs.length; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= rhs.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= lhs.length; i++) {
    for (let j = 1; j <= rhs.length; j++) {
      if (lhs[i - 1] === rhs[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }
  return matrix[lhs.length][rhs.length];
}
