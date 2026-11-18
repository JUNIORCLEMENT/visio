-- =====================================================================
--  HPO Visio — données de démonstration (facultatif)
--  Personnes FICTIVES pour tester le circuit d'invitation.
--  À supprimer avant la mise en production, puis importer le vrai
--  annuaire HPO Mail (voir README, « Importer l'annuaire »).
-- =====================================================================

BEGIN;

INSERT INTO directory_entries (email, full_name, department, job_title, site, company) VALUES
  ('rodrigue.mouketou@hpo-groupe.com', 'Rodrigue Mouketou', 'Exploitation',        'Chef d''équipe',          'Moanda',     'SGTP-MINE'),
  ('clarisse.ondo@hpo-groupe.com',     'Clarisse Ondo',     'Ressources humaines', 'Chargée de recrutement',  'Libreville', 'HPO Groupe'),
  ('franck.nguema@hpo-groupe.com',     'Franck Nguema',     'Informatique',        'Technicien support',      'Moanda',     'HPO Groupe'),
  ('sandrine.mboumba@hpo-groupe.com',  'Sandrine Mboumba',  'Finances',            'Comptable',               'Libreville', 'SOGADA'),
  ('aicha.ndong@hpo-groupe.com',       'Aïcha Ndong',       'Opérations',          'Responsable des opérations','Libreville','TRYAM'),
  ('paul.mba@hpo-groupe.com',          'Paul Mba',          'Finances',            'Contrôleur de gestion',   'Libreville', 'HPO Groupe')
ON CONFLICT (email) DO NOTHING;

-- Salles permanentes (organisateur attribué plus tard depuis l'écran Admin)
INSERT INTO meetings (code, title, department, is_permanent, allow_guests, waiting_room, recording_allowed) VALUES
  ('hpo-482-913', 'Opérations',         'Direction des opérations', true, true,  true, true),
  ('hpo-100-001', 'Direction générale', 'Direction',                true, false, true, false),
  ('hpo-730-245', 'Formation',          'Informatique',             true, true,  true, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
