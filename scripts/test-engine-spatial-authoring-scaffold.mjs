import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const includeRoot = path.join(repoRoot, 'engine', 'runtime', 'include');
const sourcePath = path.join(repoRoot, 'engine', 'runtime', 'src', 'animation_system.cpp');
const headerPath = path.join(includeRoot, 'shader_forge', 'runtime', 'animation_system.hpp');
const animationRoot = path.join(repoRoot, 'animation');
const source = fs.readFileSync(sourcePath, 'utf8');
const header = fs.readFileSync(headerPath, 'utf8');

assert.match(header, /AttachmentProfileSnapshot/);
assert.match(header, /SkeletonSocketSnapshot/);
assert.match(header, /findAttachmentProfile/);
assert.match(header, /ClipKeyframeSnapshot/);
assert.match(header, /sampleClipPose/);
assert.match(source, /loadSkeletonV2File/);
assert.match(source, /loadClipV2File/);
assert.match(source, /loadAttachmentProfileFile/);
assert.match(source, /nextAttachmentProfiles/);
assert.match(source, /sampleClipTrack/);
assert.match(source, /nlerpQuaternions/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-spatial-'));
const driverPath = path.join(tempRoot, 'spatial_driver.cpp');
const executablePath = path.join(tempRoot, process.platform === 'win32' ? 'spatial_driver' : 'spatial_driver');
const fixtureAnimationRoot = path.join(tempRoot, 'animation');
const spatialFixtureRoot = path.join(animationRoot, 'fixtures', 'spatial');
for (const directory of ['skeletons', 'clips', 'graphs']) {
  fs.cpSync(path.join(animationRoot, directory), path.join(fixtureAnimationRoot, directory), { recursive: true });
}
for (const directory of ['skeletons', 'clips', 'attachments']) {
  fs.cpSync(path.join(spatialFixtureRoot, directory), path.join(fixtureAnimationRoot, directory), { recursive: true });
}
fs.writeFileSync(path.join(fixtureAnimationRoot, 'attachments', 'README.txt'), 'ignored non-asset file');

fs.writeFileSync(driverPath, String.raw`
#include "shader_forge/runtime/animation_system.hpp"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>

using shader_forge::runtime::AnimationConfig;
using shader_forge::runtime::AnimationSystem;
using shader_forge::runtime::ClipDefinitionSnapshot;
using shader_forge::runtime::EvaluatedBonePoseSnapshot;
using shader_forge::runtime::SampledClipPoseSnapshot;
using shader_forge::runtime::SpatialAttachmentEvaluationSnapshot;
using shader_forge::runtime::SpatialQuaternionSnapshot;
using shader_forge::runtime::SpatialTransformSnapshot;
using shader_forge::runtime::SpatialVector3Snapshot;

namespace {

std::string readFile(const std::filesystem::path& path) {
  std::ifstream stream(path);
  std::ostringstream contents;
  contents << stream.rdbuf();
  return contents.str();
}

void writeFile(const std::filesystem::path& path, const std::string& contents) {
  std::ofstream stream(path, std::ios::trunc);
  stream << contents;
}

bool replaceOnce(std::string* contents, const std::string& from, const std::string& to) {
  const std::size_t offset = contents->find(from);
  if (offset == std::string::npos) return false;
  contents->replace(offset, from.size(), to);
  return true;
}

bool replaceAll(std::string* contents, const std::string& from, const std::string& to) {
  bool replaced = false;
  std::size_t offset = 0;
  while ((offset = contents->find(from, offset)) != std::string::npos) {
    contents->replace(offset, from.size(), to);
    offset += to.size();
    replaced = true;
  }
  return replaced;
}

int fail(const std::string& message) {
  std::cerr << message << '\n';
  return 1;
}

const ClipDefinitionSnapshot* findClip(const std::vector<ClipDefinitionSnapshot>& clips, const std::string& name) {
  const auto found = std::find_if(clips.begin(), clips.end(), [&](const auto& clip) { return clip.name == name; });
  return found == clips.end() ? nullptr : &*found;
}

const EvaluatedBonePoseSnapshot* findPoseBone(const std::vector<EvaluatedBonePoseSnapshot>& bones, const std::string& id) {
  const auto found = std::find_if(bones.begin(), bones.end(), [&](const auto& bone) { return bone.id == id; });
  return found == bones.end() ? nullptr : &*found;
}

bool sameVector(const SpatialVector3Snapshot& left, const SpatialVector3Snapshot& right) {
  return left.x == right.x && left.y == right.y && left.z == right.z;
}

bool sameQuaternion(const SpatialQuaternionSnapshot& left, const SpatialQuaternionSnapshot& right) {
  return left.x == right.x && left.y == right.y && left.z == right.z && left.w == right.w;
}

bool sameTransform(const SpatialTransformSnapshot& left, const SpatialTransformSnapshot& right) {
  return sameVector(left.translation, right.translation) && sameQuaternion(left.rotation, right.rotation);
}

bool sampledMatchesRest(const SampledClipPoseSnapshot& pose, const SpatialAttachmentEvaluationSnapshot& rest) {
  if (pose.bones.size() != rest.bones.size()) return false;
  for (std::size_t index = 0; index < pose.bones.size(); ++index) {
    if (pose.bones[index].id != rest.bones[index].id
        || pose.bones[index].parent != rest.bones[index].parent
        || !sameTransform(pose.bones[index].local, rest.bones[index].local)
        || !sameTransform(pose.bones[index].world, rest.bones[index].world)) {
      return false;
    }
  }
  return true;
}

std::string observableFingerprint(const AnimationSystem& system) {
  std::ostringstream out;
  out << system.skeletonCount() << '|' << system.clipCount() << '|'
      << system.graphCount() << '|' << system.attachmentProfileCount() << '|'
      << system.hasGraph("debug_actor") << '|' << system.foundationSummary() << '|' << system.graphCatalogSummary();
  if (const auto name = system.defaultGraphName()) out << "|default=" << *name;
  if (const auto graph = system.resolveGraph("debug_actor")) {
    out << "|resolved=" << graph->graphName << ',' << graph->skeletonName << ',' << graph->entryState << ',' << graph->entryClipName;
    for (const auto& name : graph->stateNames) out << "|resolved-state=" << name;
    for (const auto& name : graph->clipNames) out << "|resolved-clip=" << name;
    for (const auto& event : graph->entryClipEvents) out << "|resolved-event=" << event.name << ',' << event.timeSeconds << ',' << event.type << ',' << event.target << ',' << event.valid;
  }
  if (const auto state = system.resolveGraphState("debug_actor", "walk")) {
    out << "|state=" << state->graphName << ',' << state->stateName << ',' << state->skeletonName << ',' << state->clipName
        << ',' << state->speed << ',' << state->loop << ',' << state->durationSeconds << ',' << state->rootMotionMeters;
    for (const auto& event : state->clipEvents) out << "|state-event=" << event.name << ',' << event.timeSeconds << ',' << event.type << ',' << event.target << ',' << event.valid;
  }
  for (const auto& skeleton : system.snapshotSkeletons()) {
    out << "|sk=" << skeleton.handle.generation << ',' << skeleton.handle.index << ',' << skeleton.schemaVersion
        << ',' << skeleton.id << ',' << skeleton.name << ',' << skeleton.rootBone << ',' << skeleton.boneCount
        << ',' << skeleton.sourcePath.generic_string() << ',' << skeleton.valid;
    for (const auto& boneName : skeleton.bones) out << "|bone-name=" << boneName;
    for (const auto& bone : skeleton.boneDefinitions) {
      out << "|bone=" << bone.handle.generation << ',' << bone.handle.index << ',' << bone.id << ',' << bone.parent << ',' << bone.role
          << ',' << bone.translation.x << ',' << bone.translation.y << ',' << bone.translation.z
          << ',' << bone.rotation.x << ',' << bone.rotation.y << ',' << bone.rotation.z << ',' << bone.rotation.w;
    }
    for (const auto& socket : skeleton.sockets) {
      out << "|socket=" << socket.handle.generation << ',' << socket.handle.index << ',' << socket.id << ',' << socket.bone << ',' << socket.role
          << ',' << socket.translation.x << ',' << socket.translation.y << ',' << socket.translation.z
          << ',' << socket.rotation.x << ',' << socket.rotation.y << ',' << socket.rotation.z << ',' << socket.rotation.w;
    }
  }
  for (const auto& clip : system.snapshotClips()) {
    out << "|clip=" << clip.name << ',' << clip.skeletonName << ',' << clip.schemaVersion << ',' << clip.durationSeconds << ',' << clip.loop
        << ',' << clip.rootMotionMeters << ',' << clip.sourcePath.generic_string() << ',' << clip.valid;
    for (const auto& event : clip.events) out << "|event=" << event.name << ',' << event.timeSeconds << ',' << event.type << ',' << event.target << ',' << event.valid;
    for (const auto& track : clip.tracks) {
      out << "|track=" << track.bone;
      for (const auto& key : track.keys) {
        out << "|key=" << key.normalizedTime
            << ',' << key.translation.x << ',' << key.translation.y << ',' << key.translation.z
            << ',' << key.rotation.x << ',' << key.rotation.y << ',' << key.rotation.z << ',' << key.rotation.w;
      }
    }
  }
  for (const auto& graph : system.snapshotGraphs()) {
    out << "|graph=" << graph.name << ',' << graph.skeletonName << ',' << graph.entryState << ',' << graph.sourcePath.generic_string() << ',' << graph.valid;
    for (const auto& parameter : graph.parameters) out << "|param=" << parameter.name << ',' << parameter.type << ',' << parameter.defaultFloatValue << ',' << parameter.valid;
    for (const auto& state : graph.states) out << "|graph-state=" << state.name << ',' << state.clip << ',' << state.speed << ',' << state.loop << ',' << state.valid;
  }
  for (const auto& profile : system.snapshotAttachmentProfiles()) {
    out << "|attachment=" << profile.handle.generation << ',' << profile.handle.index
        << ',' << profile.skeletonHandle.generation << ',' << profile.skeletonHandle.index
        << ',' << profile.id << ',' << profile.name << ',' << profile.skeletonId << ',' << profile.itemPrefab
        << ',' << profile.dominantHand << ',' << profile.mode << ',' << profile.perspective
        << ',' << profile.primaryGrip.socket << ',' << profile.primaryGrip.space
        << ',' << profile.primaryGrip.socketHandle.generation << ',' << profile.primaryGrip.socketHandle.index
        << ',' << profile.primaryGrip.translation.x << ',' << profile.primaryGrip.translation.y << ',' << profile.primaryGrip.translation.z
        << ',' << profile.primaryGrip.rotation.x << ',' << profile.primaryGrip.rotation.y << ',' << profile.primaryGrip.rotation.z << ',' << profile.primaryGrip.rotation.w
        << ',' << profile.sourcePath.generic_string() << ',' << profile.valid;
    if (profile.primaryContact) {
      out << "|primary-contact=" << profile.primaryContact->translation.x << ',' << profile.primaryContact->translation.y << ',' << profile.primaryContact->translation.z
          << ',' << profile.primaryContact->rotation.x << ',' << profile.primaryContact->rotation.y << ',' << profile.primaryContact->rotation.z << ',' << profile.primaryContact->rotation.w;
    }
    if (profile.handleAxis) {
      out << "|handle-axis=" << profile.handleAxis->origin.x << ',' << profile.handleAxis->origin.y << ',' << profile.handleAxis->origin.z
          << ',' << profile.handleAxis->direction.x << ',' << profile.handleAxis->direction.y << ',' << profile.handleAxis->direction.z;
    }
    if (profile.secondaryHand) {
      out << "|secondary=" << profile.secondaryHand->enabled << ',' << profile.secondaryHand->reachMeters
          << ',' << profile.secondaryHand->angleDegrees << ',' << profile.secondaryHand->contactMeters << ',' << profile.secondaryHand->jointLimitPolicy
          << ',' << profile.secondaryHand->targetTranslation.x << ',' << profile.secondaryHand->targetTranslation.y << ',' << profile.secondaryHand->targetTranslation.z
          << ',' << profile.secondaryHand->targetRotation.x << ',' << profile.secondaryHand->targetRotation.y << ',' << profile.secondaryHand->targetRotation.z << ',' << profile.secondaryHand->targetRotation.w
          << ',' << profile.secondaryHand->poleTranslation.x << ',' << profile.secondaryHand->poleTranslation.y << ',' << profile.secondaryHand->poleTranslation.z;
    }
    for (const auto& envelope : profile.motionEnvelopes) {
      out << "|envelope=" << envelope.phase << ',' << envelope.clip;
      for (const double time : envelope.normalizedTimes) out << ',' << time;
      for (const auto& layer : envelope.proceduralLayers) out << ',' << layer;
    }
  }
  return out.str();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) return fail("expected animation root");
  const std::filesystem::path sourceRoot = argv[1];
  AnimationSystem system;
  std::string error;
  if (!system.loadFromDisk(AnimationConfig{sourceRoot}, &error)) return fail("valid fixtures rejected: " + error);
  if (system.skeletonCount() != 2 || system.attachmentProfileCount() != 2) return fail("unexpected valid fixture counts");
  const auto skeleton = system.findSkeleton("humanoid.standard.v2");
  const auto profile = system.findAttachmentProfile("weapon.rifle.mk1.humanoid");
  if (!skeleton || skeleton->id != "humanoid.standard.v2" || skeleton->sockets.size() != 3) return fail("dotted skeleton id or sockets were not preserved");
  if (!profile || profile->id != "weapon.rifle.mk1.humanoid" || !profile->secondaryHand) return fail("dotted attachment id or two-hand data were not preserved");
  const auto skeletonHandle = system.findSkeletonId("humanoid.standard.v2");
  const auto profileHandle = system.findAttachmentProfileId("weapon.rifle.mk1.humanoid");
  if (!skeletonHandle || !profileHandle || !system.snapshotSkeleton(*skeletonHandle) || !system.snapshotAttachmentProfile(*profileHandle)) return fail("typed handles did not resolve");
  if (!profile->primaryContact || !profile->handleAxis || profile->primaryGrip.translation.z == profile->secondaryHand->targetTranslation.z) return fail("attachment sections leaked or diagnostic inputs were lost");
  const auto orderedProfiles = system.snapshotAttachmentProfiles();
  if (orderedProfiles[0].id != "weapon.pistol.mk1.humanoid" || orderedProfiles[1].id != "weapon.rifle.mk1.humanoid") return fail("attachment ordering is not deterministic");

  const auto clips = system.snapshotClips();
  const auto* idleClip = findClip(clips, "debug_idle");
  const auto* walkClip = findClip(clips, "debug_walk");
  const auto* readyClip = findClip(clips, "rifle_ready");
  const auto* aimClip = findClip(clips, "rifle_aim");
  if (!idleClip || idleClip->schemaVersion != 1 || !idleClip->tracks.empty()) return fail("v1 clip compatibility was not preserved");
  if (!walkClip || walkClip->schemaVersion != 1 || !walkClip->tracks.empty()) return fail("v1 walk clip compatibility was not preserved");
  if (!readyClip || readyClip->schemaVersion != 2 || readyClip->tracks.size() != 2) return fail("rifle_ready v2 tracks were not stored");
  if (!aimClip || aimClip->schemaVersion != 2 || aimClip->tracks.size() != 3) return fail("rifle_aim v2 tracks were not stored");
  error.clear();
  if (system.sampleClipPose("debug_idle", 0.0, &error) || error.empty()) return fail("v1 clip sampling must be rejected");

  const auto rest = system.evaluateRestAttachment(*profileHandle, &error);
  if (!rest) return fail("rest evaluation failed before clip sampling: " + error);
  error.clear();
  const auto readyStart = system.sampleClipPose("rifle_ready", 0.0, &error);
  const auto readyMid = system.sampleClipPose("rifle_ready", 0.5, &error);
  const auto readyEnd = system.sampleClipPose("rifle_ready", 1.0, &error);
  if (!readyStart || !readyMid || !readyEnd) return fail("valid rifle_ready sampling was rejected: " + error);
  if (readyStart->bones.size() != skeleton->boneDefinitions.size() || readyMid->bones.size() != skeleton->boneDefinitions.size()) {
    return fail("sampled pose bone count does not match skeleton order");
  }
  for (std::size_t index = 0; index < skeleton->boneDefinitions.size(); ++index) {
    if (readyStart->bones[index].id != skeleton->boneDefinitions[index].id
        || readyMid->bones[index].id != skeleton->boneDefinitions[index].id
        || readyEnd->bones[index].id != skeleton->boneDefinitions[index].id) {
      return fail("sampled pose is not in stable skeleton order");
    }
  }
  if (!sampledMatchesRest(*readyStart, *rest) || !sampledMatchesRest(*readyEnd, *rest)) return fail("rifle_ready endpoints were not exact rest poses");
  const auto* restArm = findPoseBone(rest->bones, "upper_arm_r");
  const auto* restForearm = findPoseBone(rest->bones, "lower_arm_r");
  const auto* restHand = findPoseBone(rest->bones, "hand_r");
  const auto* restHips = findPoseBone(rest->bones, "hips");
  const auto* midArm = findPoseBone(readyMid->bones, "upper_arm_r");
  const auto* midForearm = findPoseBone(readyMid->bones, "lower_arm_r");
  const auto* midHand = findPoseBone(readyMid->bones, "hand_r");
  const auto* midHips = findPoseBone(readyMid->bones, "hips");
  if (!restArm || !restForearm || !restHand || !restHips || !midArm || !midForearm || !midHand || !midHips) {
    return fail("required sampled bones were missing");
  }
  if (midArm->local.translation.y != 0.05 || midArm->local.translation.z != 0.10) return fail("exact midpoint translation was not sampled");
  if (sameVector(midArm->local.translation, restArm->local.translation)) return fail("midpoint pose was not observably different from rest");
  if (!sameTransform(midForearm->local, restForearm->local)) return fail("untracked bone did not keep rest local transform");
  if (midForearm->world.translation.y != restForearm->world.translation.y + 0.05
      || midForearm->world.translation.z != restForearm->world.translation.z + 0.10) {
    return fail("composed parent world motion was not applied to untracked child");
  }
  if (midHand->local.translation.y != 0.03 || midHand->local.translation.z != 0.04) return fail("tracked hand midpoint was not exact");
  if (midHand->world.translation.y != restHand->world.translation.y + 0.08
      || midHand->world.translation.z != restHand->world.translation.z + 0.14) {
    return fail("composed world hand motion was not exact");
  }
  if (!sameTransform(midHips->local, restHips->local) || !sameTransform(midHips->world, restHips->world)) {
    return fail("sampling accumulated root motion or moved the untracked root");
  }

  error.clear();
  const auto aimStart = system.sampleClipPose("rifle_aim", 0.0, &error);
  const auto aimMid = system.sampleClipPose("rifle_aim", 0.5, &error);
  const auto aimEnd = system.sampleClipPose("rifle_aim", 1.0, &error);
  if (!aimStart || !aimMid || !aimEnd) return fail("valid rifle_aim sampling was rejected: " + error);
  const auto* aimStartHand = findPoseBone(aimStart->bones, "hand_l");
  const auto* aimMidHand = findPoseBone(aimMid->bones, "hand_l");
  const auto* aimEndHand = findPoseBone(aimEnd->bones, "hand_l");
  if (!aimStartHand || !aimMidHand || !aimEndHand) return fail("rifle_aim hand_l sample was missing");
  if (aimStartHand->local.rotation.x != 0.8 || aimStartHand->local.rotation.w != 0.6) return fail("rifle_aim start quaternion was not exact");
  if (aimEndHand->local.rotation.x != -0.8 || aimEndHand->local.rotation.w != 0.6) return fail("rifle_aim end quaternion was not exact");
  if (aimMidHand->local.rotation.x != 1.0 || aimMidHand->local.rotation.y != 0.0
      || aimMidHand->local.rotation.z != 0.0 || aimMidHand->local.rotation.w != 0.0) {
    return fail("shortest-path quaternion interpolation was not used");
  }

  const auto markerBoneRoot = std::filesystem::temp_directory_path() / "shader_forge_spatial_marker_bone";
  std::filesystem::remove_all(markerBoneRoot);
  std::filesystem::copy(sourceRoot, markerBoneRoot, std::filesystem::copy_options::recursive);
  const auto markerSkeletonPath = markerBoneRoot / "skeletons/spatial_humanoid.skeleton.toml";
  std::string markerSkeleton = readFile(markerSkeletonPath);
  const bool markerSkeletonReplaced =
    replaceAll(&markerSkeleton, "[bone.upper_arm_r]", "[bone.upper.key.arm]")
    && replaceAll(&markerSkeleton, "id = \"upper_arm_r\"", "id = \"upper.key.arm\"")
    && replaceAll(&markerSkeleton, "parent = \"upper_arm_r\"", "parent = \"upper.key.arm\"");
  if (!markerSkeletonReplaced) return fail("marker skeleton fixture replacement failed");
  writeFile(markerSkeletonPath, markerSkeleton);
  for (const auto& relative : {
         std::filesystem::path("clips/rifle_ready.anim.toml"),
         std::filesystem::path("clips/rifle_aim.anim.toml")}) {
    const auto target = markerBoneRoot / relative;
    std::string contents = readFile(target);
    if (!replaceAll(&contents, "track.upper_arm_r.", "track.upper.key.arm.")) {
      return fail("marker clip fixture replacement failed");
    }
    writeFile(target, contents);
  }
  AnimationSystem markerBoneSystem;
  error.clear();
  if (!markerBoneSystem.loadFromDisk(AnimationConfig{markerBoneRoot}, &error)) {
    return fail("bone id containing .key. was rejected: " + error);
  }
  const auto markerBonePose = markerBoneSystem.sampleClipPose("rifle_ready", 0.5, &error);
  if (!markerBonePose || !findPoseBone(markerBonePose->bones, "upper.key.arm")) {
    return fail("bone id containing .key. could not be sampled: " + error);
  }
  std::filesystem::remove_all(markerBoneRoot);

  error.clear();
  if (system.sampleClipPose("rifle_ready", std::numeric_limits<double>::quiet_NaN(), &error)
      || system.sampleClipPose("rifle_ready", std::numeric_limits<double>::infinity(), &error)
      || system.sampleClipPose("rifle_ready", -0.1, &error)
      || system.sampleClipPose("rifle_ready", 1.1, &error)
      || error.empty()) {
    return fail("non-finite or out-of-range sample time was accepted");
  }

  const auto retainedSkeletonCount = system.skeletonCount();
  const auto retainedProfile = profile->id;
  const std::string retainedObservables = observableFingerprint(system);
  int caseIndex = 0;
  const auto stateWasRetained = [&]() {
    const auto retained = system.findAttachmentProfile(retainedProfile);
    return observableFingerprint(system) == retainedObservables
      && system.skeletonCount() == retainedSkeletonCount
      && retained && retained->id == retainedProfile
      && system.findAttachmentProfileId(retainedProfile) == profileHandle
      && system.snapshotAttachmentProfile(*profileHandle).has_value();
  };
  auto rejectMutation = [&](const std::filesystem::path& relative, const std::string& from, const std::string& to) -> bool {
    const auto caseRoot = std::filesystem::temp_directory_path() / ("shader_forge_spatial_case_" + std::to_string(++caseIndex));
    std::filesystem::remove_all(caseRoot);
    std::filesystem::copy(sourceRoot, caseRoot, std::filesystem::copy_options::recursive);
    const auto target = caseRoot / relative;
    std::string contents = readFile(target);
    if (!replaceOnce(&contents, from, to)) return false;
    writeFile(target, contents);
    error.clear();
    const bool rejected = !system.loadFromDisk(AnimationConfig{caseRoot}, &error) && !error.empty();
    const bool stateIntact = stateWasRetained();
    std::filesystem::remove_all(caseRoot);
    return rejected && stateIntact;
  };
  auto rejectAddedCopy = [&](const std::filesystem::path& relative, const std::filesystem::path& copyRelative) -> bool {
    const auto caseRoot = std::filesystem::temp_directory_path() / ("shader_forge_spatial_copy_case_" + std::to_string(++caseIndex));
    std::filesystem::remove_all(caseRoot);
    std::filesystem::copy(sourceRoot, caseRoot, std::filesystem::copy_options::recursive);
    std::filesystem::copy_file(caseRoot / relative, caseRoot / copyRelative);
    error.clear();
    const bool rejected = !system.loadFromDisk(AnimationConfig{caseRoot}, &error) && !error.empty();
    const bool stateIntact = stateWasRetained();
    std::filesystem::remove_all(caseRoot);
    return rejected && stateIntact;
  };
  auto rejectDirectoryAsFile = [&](const std::filesystem::path& relative) -> bool {
    const auto caseRoot = std::filesystem::temp_directory_path() / ("shader_forge_spatial_root_case_" + std::to_string(++caseIndex));
    std::filesystem::remove_all(caseRoot);
    std::filesystem::copy(sourceRoot, caseRoot, std::filesystem::copy_options::recursive);
    std::filesystem::remove_all(caseRoot / relative);
    writeFile(caseRoot / relative, "not a directory");
    error.clear();
    const bool rejected = !system.loadFromDisk(AnimationConfig{caseRoot}, &error) && !error.empty();
    const bool stateIntact = stateWasRetained();
    std::filesystem::remove_all(caseRoot);
    return rejected && stateIntact;
  };

  const std::filesystem::path skeletonFile = "skeletons/spatial_humanoid.skeleton.toml";
  const std::filesystem::path attachmentFile = "attachments/rifle_mk1_humanoid.attachment.toml";
  const std::filesystem::path clipFile = "clips/rifle_ready.anim.toml";
  const std::filesystem::path graphFile = "graphs/debug_actor.animgraph.toml";
  if (!rejectMutation(skeletonFile, "schema_version = 2", "schema_version = 99")) return fail("unknown skeleton version accepted");
  if (!rejectMutation(skeletonFile, "[socket.palm_l]", "[unexpected]")) return fail("unknown skeleton section accepted");
  if (!rejectMutation(skeletonFile, "parent = \"hips\"", "parent = \"missing\"")) return fail("missing bone parent accepted");
  if (!rejectMutation(skeletonFile, "parent = \"hips\"", "parent = \"hand_l\"")) return fail("bone cycle accepted");
  if (!rejectMutation(skeletonFile, "role = \"hand_l\"", "role = \"hand_r\"")) return fail("duplicate semantic role accepted");
  if (!rejectMutation(skeletonFile, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, 0.5]")) return fail("non-unit quaternion accepted");
  if (!rejectMutation(skeletonFile, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 1.0]")) return fail("wrong-length quaternion accepted");
  if (!rejectMutation(skeletonFile, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, nan]")) return fail("non-finite quaternion accepted");
  if (!rejectMutation(skeletonFile, "role = \"primary_grip\"", "role = \"utility\"")) return fail("wrong primary socket role accepted");
  if (!rejectMutation(attachmentFile, "mode = \"two_hand\"", "mode = \"three_hand\"")) return fail("invalid attachment mode accepted");
  if (!rejectMutation(attachmentFile, "schema_version = 1", "schema_version = 2")) return fail("unknown attachment version accepted");
  if (!rejectMutation(attachmentFile, "schema_version = 1", "schema_version = nope")) return fail("malformed attachment version accepted without diagnostics");
  if (!rejectMutation(attachmentFile, "perspective = \"both\"", "perspective = \"both\"\nunknown_key = true")) return fail("unknown attachment key accepted");
  if (!rejectMutation(attachmentFile, "skeleton = \"humanoid.standard.v2\"", "skeleton = \"missing.skeleton\"")) return fail("missing attachment skeleton accepted");
  if (!rejectMutation(attachmentFile, "socket = \"socket.hand_r.primary\"", "socket = \"socket.missing\"")) return fail("missing primary socket accepted");
  if (!rejectMutation(attachmentFile, "enabled = true", "enabled = false")) return fail("missing two-hand enablement accepted");
  if (!rejectMutation(attachmentFile, "clip = \"rifle_ready\"", "clip = \"missing_clip\"")) return fail("missing envelope clip accepted");
  if (!rejectMutation(attachmentFile, "normalized_times = [0.0, 0.5, 1.0]", "normalized_times = [0.0, ]")) return fail("malformed array accepted");
  if (!rejectMutation(attachmentFile, "reach_meters = 0.04", "reach_meters = -0.01")) return fail("invalid tolerance range accepted");
  if (!rejectMutation(attachmentFile, "space = \"socket\"", "space = \"socket\"\nspace = \"socket\"")) return fail("duplicate key accepted");
  if (!rejectMutation(attachmentFile, "[motion_envelope.idle]", "[unknown_section]")) return fail("unknown section accepted");
  if (!rejectMutation(clipFile, "skeleton = \"humanoid.standard.v2\"", "skeleton = \"debug_humanoid\"")) return fail("envelope skeleton mismatch accepted");
  if (!rejectMutation(clipFile, "name = \"rifle_ready\"", "name = \"debug_idle\"")) return fail("duplicate clip name accepted");
  if (!rejectMutation(clipFile, "schema_version = 2", "schema_version = 99")) return fail("unknown clip version accepted");
  if (!rejectMutation(clipFile, "[track.upper_arm_r.key.0]", "[unexpected]")) return fail("unknown clip section accepted");
  if (!rejectMutation(clipFile, "[track.upper_arm_r.key.0]", "[track.missing_bone.key.0]")) return fail("missing clip bone reference accepted");
  if (!rejectMutation(clipFile, "normalized_time = 0.5", "normalized_time = 0.0")) return fail("non-increasing clip key times accepted");
  if (!rejectMutation(clipFile, "normalized_time = 0.0", "normalized_time = 0.1")) return fail("clip track missing 0.0 endpoint accepted");
  if (!rejectMutation(clipFile, "normalized_time = 1.0", "normalized_time = 0.9")) return fail("clip track missing 1.0 endpoint accepted");
  if (!rejectMutation(clipFile, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, 0.5]")) return fail("non-unit clip quaternion accepted");
  if (!rejectMutation(clipFile, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 1.0]")) return fail("malformed clip quaternion accepted");
  if (!rejectMutation(clipFile, "translation = [-0.14, 0.0, 0.0]", "translation = [-0.14, nan, 0.0]")) return fail("non-finite clip translation accepted");
  if (!rejectMutation(clipFile, "normalized_time = 0.0", "normalized_time = 0.0\nunknown_key = true")) return fail("unknown clip key accepted");
  if (!rejectMutation(clipFile, "normalized_time = 0.0", "normalized_time = 0.0\nnormalized_time = 0.0")) return fail("duplicate clip key accepted");
  if (!rejectMutation(graphFile, "[state.walk]", "[state.idle]")) return fail("duplicate graph state name accepted");
  if (!rejectAddedCopy(graphFile, "graphs/duplicate.animgraph.toml")) return fail("duplicate graph name accepted");
  if (!rejectDirectoryAsFile("skeletons") || !rejectDirectoryAsFile("clips") || !rejectDirectoryAsFile("graphs")) {
    return fail("required animation roots accepted non-directory paths or leaked state");
  }

  if (!rejectAddedCopy(attachmentFile, "attachments/duplicate.attachment.toml")) {
    return fail("duplicate attachment id accepted or leaked partial state");
  }

  const auto negativeQuaternionRoot = std::filesystem::temp_directory_path() / "shader_forge_spatial_negative_quaternion";
  std::filesystem::remove_all(negativeQuaternionRoot);
  std::filesystem::copy(sourceRoot, negativeQuaternionRoot, std::filesystem::copy_options::recursive);
  std::string negativeQuaternion = readFile(negativeQuaternionRoot / skeletonFile);
  if (!replaceOnce(&negativeQuaternion, "rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, -1.0]")) return fail("negative quaternion fixture mutation failed");
  writeFile(negativeQuaternionRoot / skeletonFile, negativeQuaternion);
  AnimationSystem canonicalized;
  if (!canonicalized.loadFromDisk(AnimationConfig{negativeQuaternionRoot}, &error)) return fail("valid negative-sign quaternion rejected: " + error);
  const auto canonicalSkeleton = canonicalized.findSkeleton("humanoid.standard.v2");
  if (!canonicalSkeleton) return fail("canonical skeleton lookup failed");
  const auto hips = std::find_if(canonicalSkeleton->boneDefinitions.begin(), canonicalSkeleton->boneDefinitions.end(), [](const auto& bone) { return bone.id == "hips"; });
  if (hips == canonicalSkeleton->boneDefinitions.end() || hips->rotation.w != 1.0) return fail("quaternion sign was not canonicalized");
  std::filesystem::remove_all(negativeQuaternionRoot);

  const auto stableHandleRoot = std::filesystem::temp_directory_path() / "shader_forge_spatial_stable_handles";
  std::filesystem::remove_all(stableHandleRoot);
  std::filesystem::copy(sourceRoot, stableHandleRoot, std::filesystem::copy_options::recursive);
  std::string addedSkeleton = readFile(stableHandleRoot / skeletonFile);
  if (!replaceOnce(&addedSkeleton, "id = \"humanoid.standard.v2\"", "id = \"aaa.humanoid\"")
      || !replaceOnce(&addedSkeleton, "name = \"spatial_humanoid\"", "name = \"aaa_humanoid\"")) return fail("stable skeleton fixture mutation failed");
  writeFile(stableHandleRoot / "skeletons/aaa.skeleton.toml", addedSkeleton);
  std::string addedAttachment = readFile(stableHandleRoot / "attachments/pistol_mk1_humanoid.attachment.toml");
  if (!replaceOnce(&addedAttachment, "id = \"weapon.pistol.mk1.humanoid\"", "id = \"aaa.attachment\"")
      || !replaceOnce(&addedAttachment, "name = \"Pistol Mk1 Humanoid\"", "name = \"AAA Attachment\"")) return fail("stable attachment fixture mutation failed");
  writeFile(stableHandleRoot / "attachments/aaa.attachment.toml", addedAttachment);
  AnimationSystem stableHandles;
  if (!stableHandles.loadFromDisk(AnimationConfig{sourceRoot}, &error)) return fail("stable-handle baseline rejected: " + error);
  const auto oldSkeletonHandle = stableHandles.findSkeletonId("humanoid.standard.v2");
  const auto oldAttachmentHandle = stableHandles.findAttachmentProfileId("weapon.rifle.mk1.humanoid");
  if (!stableHandles.loadFromDisk(AnimationConfig{stableHandleRoot}, &error)) return fail("stable-handle reload rejected: " + error);
  const auto newSkeletonHandle = stableHandles.findSkeletonId("humanoid.standard.v2");
  const auto newAttachmentHandle = stableHandles.findAttachmentProfileId("weapon.rifle.mk1.humanoid");
  if (!oldSkeletonHandle || !oldAttachmentHandle || !newSkeletonHandle || !newAttachmentHandle
      || *newSkeletonHandle == *oldSkeletonHandle || *newAttachmentHandle == *oldAttachmentHandle
      || stableHandles.snapshotSkeleton(*oldSkeletonHandle) || stableHandles.snapshotAttachmentProfile(*oldAttachmentHandle)
      || !stableHandles.snapshotSkeleton(*newSkeletonHandle) || !stableHandles.snapshotAttachmentProfile(*newAttachmentHandle)) {
    return fail("typed handles did not invalidate safely after successful reload");
  }
  std::filesystem::remove_all(stableHandleRoot);

  const auto noAttachmentsRoot = std::filesystem::temp_directory_path() / "shader_forge_spatial_no_attachments";
  std::filesystem::remove_all(noAttachmentsRoot);
  std::filesystem::copy(sourceRoot, noAttachmentsRoot, std::filesystem::copy_options::recursive);
  std::filesystem::remove_all(noAttachmentsRoot / "attachments");
  AnimationSystem noAttachments;
  if (!noAttachments.loadFromDisk(AnimationConfig{noAttachmentsRoot}, &error) || noAttachments.attachmentProfileCount() != 0) {
    return fail("missing attachments directory must remain valid");
  }
  std::filesystem::remove_all(noAttachmentsRoot);
  std::cout << "native spatial authoring validation passed\n";
  return 0;
}
`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed.\n${result.stderr || result.stdout}`);
}

function toWslPath(windowsPath) {
  const normalized = windowsPath.replaceAll('\\', '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  assert.ok(match, `Cannot map path to WSL: ${windowsPath}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

let nativeChecked = false;
const nativeRequired = process.platform === 'win32'
  || process.env.SHADER_FORGE_REQUIRE_NATIVE_SPATIAL === '1';
try {
  if (process.platform === 'win32') {
    const compiler = spawnSync('wsl.exe', ['sh', '-lc', 'command -v g++'], { encoding: 'utf8' });
    const compilerAvailable = !compiler.error && compiler.status === 0;
    if (!compilerAvailable && nativeRequired) {
      assert.fail(`Native spatial harness requires WSL g++ on Windows.\n${compiler.error?.message || compiler.stderr || compiler.stdout}`);
    }
    if (compilerAvailable) {
      run('wsl.exe', [
        'g++', '-std=c++20', '-I', toWslPath(includeRoot),
        toWslPath(driverPath), toWslPath(sourcePath), '-o', toWslPath(executablePath),
      ]);
      run('wsl.exe', [toWslPath(executablePath), toWslPath(fixtureAnimationRoot)]);
      nativeChecked = true;
    }
  } else {
    const compiler = spawnSync('g++', ['--version'], { encoding: 'utf8' });
    const compilerAvailable = !compiler.error && compiler.status === 0;
    if (!compilerAvailable && nativeRequired) {
      assert.fail(`Native spatial harness requires g++.\n${compiler.error?.message || compiler.stderr || compiler.stdout}`);
    }
    if (compilerAvailable) {
      run('g++', ['-std=c++20', '-I', includeRoot, driverPath, sourcePath, '-o', executablePath]);
      run(executablePath, [fixtureAnimationRoot]);
      nativeChecked = true;
    }
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Engine spatial authoring scaffold passed.');
console.log('- Verified strict v2 skeleton/socket and v1 attachment-profile contracts');
console.log('- Verified v1 clip compatibility and v2 clip sampling, rest fallback, and quaternion interpolation');
console.log('- Verified dotted IDs, representative rejection cases, and transactional reload state');
console.log(nativeChecked
  ? '- Compiled and ran the native spatial parser harness'
  : '- SKIPPED native parser execution: no supported g++ compiler was available (set SHADER_FORGE_REQUIRE_NATIVE_SPATIAL=1 to make this fatal)');
