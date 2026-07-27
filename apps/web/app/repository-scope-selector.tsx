"use client";

import type { RepositoryResponse } from "@flawferret2/job-schemas";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const storageKey = "flawferret2.repositoryScopeId";
const scopedPaths = new Set(["/discover", "/features", "/jobs/new"]);

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

const shouldScopePath = (pathname: string) =>
  scopedPaths.has(pathname) || pathname.startsWith("/features/");

type RepositoryScopeSelectorProps = {
  repositories: RepositoryResponse[];
};

export function RepositoryScopeSelector({ repositories }: RepositoryScopeSelectorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const repositoryIdFromUrl = searchParams.get("repositoryId") ?? "";
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(repositoryIdFromUrl);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );

  useEffect(() => {
    if (repositoryIdFromUrl) {
      localStorage.setItem(storageKey, repositoryIdFromUrl);
      setSelectedRepositoryId(repositoryIdFromUrl);
      return;
    }

    const savedRepositoryId = localStorage.getItem(storageKey) ?? "";
    const savedRepositoryExists = repositories.some((repository) => repository.id === savedRepositoryId);

    if (!savedRepositoryExists) {
      localStorage.removeItem(storageKey);
      setSelectedRepositoryId("");
      return;
    }

    setSelectedRepositoryId(savedRepositoryId);

    if (savedRepositoryId && shouldScopePath(pathname)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("repositoryId", savedRepositoryId);
      router.replace(`${pathname}?${params.toString()}`, {
        scroll: false,
      });
    }
  }, [pathname, repositories, repositoryIdFromUrl, router, searchParams]);

  const updateScope = (repositoryId: string) => {
    if (repositoryId === "__new__") {
      router.push("/repositories");
      return;
    }

    setSelectedRepositoryId(repositoryId);

    if (repositoryId) {
      localStorage.setItem(storageKey, repositoryId);
    } else {
      localStorage.removeItem(storageKey);
    }

    if (shouldScopePath(pathname)) {
      const params = new URLSearchParams(searchParams.toString());

      if (repositoryId) {
        params.set("repositoryId", repositoryId);
      } else {
        params.delete("repositoryId");
      }

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  };

  return (
    <section className="scope-card" aria-label="Repository scope">
      <label>
        <span>Scope</span>
        <select
          aria-label="Repository scope"
          value={selectedRepositoryId}
          onChange={(event) => updateScope((event.currentTarget as unknown as { value: string }).value)}
        >
          <option value="">Select repository</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repositoryLabel(repository)}
            </option>
          ))}
          <option value="__new__">New repository...</option>
        </select>
      </label>
      {selectedRepository ? <small>{selectedRepository.defaultBranch}</small> : <small>No repository selected</small>}
    </section>
  );
}
