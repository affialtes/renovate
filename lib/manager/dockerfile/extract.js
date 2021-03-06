module.exports = {
  splitImageParts,
  getPurl,
  getDep,
  extractPackageFile,
};

function splitImageParts(currentFrom) {
  let dockerRegistry;
  const split = currentFrom.split('/');
  if (split.length > 1 && split[0].includes('.')) {
    [dockerRegistry] = split;
    split.shift();
  }
  const currentDepTagDigest = split.join('/');
  const [currentDepTag, currentDigest] = currentDepTagDigest.split('@');
  const [depName, currentValue] = currentDepTag.split(':');
  return {
    dockerRegistry,
    depName,
    currentDigest,
    currentDepTagDigest,
    currentDepTag,
    currentValue,
  };
}

function getPurl(dockerRegistry, depName) {
  let purl = `pkg:docker/${depName}`;
  if (dockerRegistry) {
    purl += `?registry=${dockerRegistry}`;
  }
  return purl;
}

function getDep(currentFrom) {
  const dep = {
    ...splitImageParts(currentFrom),
    currentFrom,
  };
  const purl = getPurl(dep.dockerRegistry, dep.depName);
  dep.purl = purl;
  if (
    (dep.depName === 'node' || dep.depName.endsWith('/node')) &&
    dep.depName !== 'calico/node'
  ) {
    dep.commitMessageTopic = 'Node.js';
  }
  return dep;
}

function extractPackageFile(content) {
  const deps = [];
  const stageNames = [];
  let lineNumber = 0;
  for (const fromLine of content.split('\n')) {
    const fromMatch = fromLine.match(/^FROM /i);
    if (fromMatch) {
      logger.debug({ lineNumber, fromLine }, 'FROM line');
      const [fromPrefix, currentFrom, ...fromRest] = fromLine.match(/\S+/g);
      if (fromRest.length === 2 && fromRest[0].toLowerCase() === 'as') {
        logger.debug('Found a multistage build stage name');
        stageNames.push(fromRest[1]);
      }
      const fromSuffix = fromRest.join(' ');
      if (currentFrom === 'scratch') {
        logger.debug('Skipping scratch');
      } else if (stageNames.includes(currentFrom)) {
        logger.debug({ currentFrom }, 'Skipping alias FROM');
      } else {
        const dep = getDep(currentFrom);
        logger.debug(
          {
            depName: dep.depName,
            currentValue: dep.currentValue,
            currentDigest: dep.currentDigest,
          },
          'Dockerfile FROM'
        );
        dep.lineNumber = lineNumber;
        dep.fromPrefix = fromPrefix;
        dep.fromSuffix = fromSuffix;
        deps.push(dep);
      }
    }

    const copyFromMatch = fromLine.match(/^(COPY --from=)([^\s]+)\s+(.*)$/i);
    if (copyFromMatch) {
      const [fromPrefix, currentFrom, fromSuffix] = copyFromMatch.slice(1);
      logger.debug({ lineNumber, fromLine }, 'COPY --from line');
      if (stageNames.includes(currentFrom)) {
        logger.debug({ currentFrom }, 'Skipping alias COPY --from');
      } else if (!Number.isNaN(Number(currentFrom))) {
        logger.debug({ currentFrom }, 'Skipping index reference COPY --from');
      } else {
        const dep = getDep(currentFrom);
        logger.info(
          {
            depName: dep.depName,
            currentValue: dep.currentValue,
            currentDigest: dep.currentDigest,
          },
          'Dockerfile COPY --from'
        );
        dep.lineNumber = lineNumber;
        dep.fromPrefix = fromPrefix;
        dep.fromSuffix = fromSuffix;
        deps.push(dep);
      }
    }
    lineNumber += 1;
  }
  if (!deps.length) {
    return null;
  }
  return { deps };
}
