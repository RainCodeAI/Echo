/** next/image stand-in. */
export default function Image(props: { src: string; alt: string; width?: number; height?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={props.src} alt={props.alt} width={props.width} height={props.height} className={props.className} />;
}
