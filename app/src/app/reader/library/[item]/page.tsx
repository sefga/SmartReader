import Reader from '../../../../components/Reader';
export function generateStaticParams() {
  return [{ item: 'demo' }];
}
export default function LibraryItem() { return <Reader />; }
