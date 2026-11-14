import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/context";
import { visibleWorkshopNavigation } from "../lib/workshopNavigation";

export function Home() {
  const { session } = useApp();
  const { groups, footer } = visibleWorkshopNavigation(session);
  const sections = [
    ...groups,
    ...(footer.length ? [{ title: "AJUDA E CONFIGURAÇÕES", items: footer }] : []),
  ];

  return (
    <div className="module-home">
      <header className="module-home-heading">
        <span>{session.tenant.name}</span>
        <h1>Por onde vamos começar?</h1>
        <p>Escolha uma área para cuidar da sua oficina.</p>
      </header>
      {sections.map((section) => (
        <section className="module-section" key={section.title} aria-label={section.title}>
          <h2>{section.title}</h2>
          <div className="module-grid">
            {section.items.map(({ path, label, description, Icon }) => (
              <Link to={path} className="module-card" key={path}>
                <div className="module-card-top">
                  <span className="module-icon"><Icon size={23} aria-hidden="true" /></span>
                  <ArrowUpRight className="module-arrow" size={19} aria-hidden="true" />
                </div>
                <h3>{label}</h3>
                <p>{description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
