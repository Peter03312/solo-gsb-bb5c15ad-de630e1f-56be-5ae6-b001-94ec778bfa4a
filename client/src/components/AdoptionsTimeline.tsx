import type { Adoption } from '../types';

export function AdoptionsTimeline({ adoptions }: { adoptions: Adoption[] }) {
  if (adoptions.length === 0) return <p className="muted">尚无采纳记录。</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>建议</th>
          <th>原文</th>
          <th>替换为</th>
          <th>版本</th>
          <th>采纳人</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        {adoptions.map((a) => (
          <tr key={a.id}>
            <td>{a.id}</td>
            <td>#{a.suggestionId}</td>
            <td className="cell-old">{a.oldText || <em className="muted">（空）</em>}</td>
            <td className="cell-new">{a.newText ? a.newText : <em className="muted">（删除）</em>}</td>
            <td>v{a.fromVersion}→v{a.toVersion}</td>
            <td>{a.adopterName}</td>
            <td>{a.appliedAt.replace('T', ' ').slice(0, 16)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
